import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { getBranchByName } from "@/lib/mind/branches";
import { diffLinks, diffMemoryText, diffStates } from "@/lib/mind/diff";
import { resolveRef } from "@/lib/mind/refs";
import { linksAt, linksToState, rowsToState, stateAt } from "@/lib/mind/state";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }
  const userId = auth.identity.userId;

  const fromRef = (req.nextUrl.searchParams.get("from") ?? "").trim();
  const toRef = (req.nextUrl.searchParams.get("to") ?? "").trim();
  if (!fromRef || !toRef) {
    return NextResponse.json(
      { error: "Pass from and to — each a branch name, commit id, or timestamp." },
      { status: 400 }
    );
  }

  try {
    const branchHintName = req.nextUrl.searchParams.get("branch");
    const branchHint = branchHintName ? (await getBranchByName(admin, userId, branchHintName)) ?? undefined : undefined;

    const [from, to] = await Promise.all([
      resolveRef(admin, userId, fromRef, { branchHint }),
      resolveRef(admin, userId, toRef, { branchHint }),
    ]);
    if (!from) return NextResponse.json({ error: `Could not resolve ref "${fromRef}".` }, { status: 404 });
    if (!to) return NextResponse.json({ error: `Could not resolve ref "${toRef}".` }, { status: 404 });

    const [fromRows, toRows] = await Promise.all([
      stateAt(admin, userId, from.commitId),
      stateAt(admin, userId, to.commitId),
    ]);
    const fromState = rowsToState(fromRows);
    const toState = rowsToState(toRows);

    const memoryId = (req.nextUrl.searchParams.get("memory_id") ?? "").trim();
    if (memoryId) {
      const before = fromState.get(memoryId);
      const after = toState.get(memoryId);
      if (!before && !after) {
        return NextResponse.json({ error: "That memory exists at neither ref." }, { status: 404 });
      }
      return NextResponse.json({
        from: { ref: fromRef, commit_id: from.commitId },
        to: { ref: toRef, commit_id: to.commitId },
        memory_id: memoryId,
        title_from: before?.title ?? null,
        title_to: after?.title ?? null,
        tags_added: (after?.tags ?? []).filter((t) => !(before?.tags ?? []).includes(t)),
        tags_removed: (before?.tags ?? []).filter((t) => !(after?.tags ?? []).includes(t)),
        status: !before ? "added" : !after ? "removed" : "changed",
        diff: diffMemoryText(before?.content ?? "", after?.content ?? ""),
      });
    }

    const [fromLinks, toLinks] = await Promise.all([
      linksAt(admin, userId, from.commitId),
      linksAt(admin, userId, to.commitId),
    ]);

    const stateDiff = diffStates(fromState, toState);
    return NextResponse.json({
      from: { ref: fromRef, commit_id: from.commitId },
      to: { ref: toRef, commit_id: to.commitId },
      memories: {
        added: stateDiff.added.map((m) => ({ id: m.memory_id, title: m.title, tags: m.tags })),
        removed: stateDiff.removed.map((m) => ({ id: m.memory_id, title: m.title, tags: m.tags })),
        changed: stateDiff.changed.map((c) => ({
          id: c.memory_id,
          title_from: c.title_from,
          title_to: c.title_to,
          tags_added: c.tags_added,
          tags_removed: c.tags_removed,
          content_changed: c.content_changed,
          diff: c.diff,
        })),
      },
      links: diffLinks(linksToState(fromLinks), linksToState(toLinks)),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Diff failed." }, { status: 500 });
  }
}
