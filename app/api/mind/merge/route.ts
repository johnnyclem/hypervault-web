import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { summarize } from "@/lib/memory";
import { getBranchByName, resolveBranch } from "@/lib/mind/branches";
import { StaleHeadError, recordCommit } from "@/lib/mind/commits";
import { diffMemoryText } from "@/lib/mind/diff";
import { applyResolutions, findMergeBase, mergeLinkSets, threeWayMerge } from "@/lib/mind/merge";
import { branchState, linksAt, linksToState, rowsToState, stateAt } from "@/lib/mind/state";
import type { MemoryState, MergeResolution } from "@/lib/mind/types";
import { linkKey } from "@/lib/mind/types";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const sourceName = typeof body.source === "string" ? body.source.trim() : "";
  if (!sourceName) return NextResponse.json({ error: "source is required — the branch to merge." }, { status: 400 });
  const targetName = typeof body.target === "string" && body.target.trim() ? body.target.trim() : "main";
  if (sourceName === targetName) {
    return NextResponse.json({ error: "source and target are the same branch." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }
  const userId = auth.identity.userId;

  try {
    const source = await getBranchByName(admin, userId, sourceName);
    if (!source) return NextResponse.json({ error: `No such branch "${sourceName}".` }, { status: 404 });
    const target = await resolveBranch(admin, userId, targetName);
    if (!target) return NextResponse.json({ error: `No such branch "${targetName}".` }, { status: 404 });
    if (!source.head_commit_id) {
      return NextResponse.json({ error: `Branch "${sourceName}" has no commits to merge.` }, { status: 400 });
    }

    const { data: commitRows, error: commitsError } = await admin
      .from("memory_commits")
      .select("id, parent_commit_id, merge_parent_commit_id")
      .eq("user_id", userId);
    if (commitsError) throw new Error(commitsError.message);
    const mergeBase =
      target.head_commit_id === null
        ? null
        : findMergeBase(commitRows ?? [], target.head_commit_id, source.head_commit_id);

    if (mergeBase === source.head_commit_id) {
      return NextResponse.json({
        commit_id: null,
        merged: { created: 0, updated: 0, deleted: 0 },
        links_changed: 0,
        message: `Already up to date — ${targetName} contains everything on ${sourceName}.`,
      });
    }

    const [baseRows, oursRows, theirsRows, baseLinks] = await Promise.all([
      mergeBase ? stateAt(admin, userId, mergeBase) : Promise.resolve([]),
      branchState(admin, userId, target.id),
      branchState(admin, userId, source.id),
      mergeBase ? linksAt(admin, userId, mergeBase) : Promise.resolve([]),
    ]);
    const base: MemoryState = rowsToState(baseRows);
    const ours: MemoryState = rowsToState(oursRows);
    const theirs: MemoryState = rowsToState(theirsRows);

    const resolutions: MergeResolution[] = Array.isArray(body.resolutions)
      ? (body.resolutions as MergeResolution[]).filter((r) => r && typeof r.memory_id === "string")
      : [];

    const outcome = applyResolutions(threeWayMerge(base, ours, theirs), resolutions, summarize);
    if (outcome.conflicts.length > 0) {
      return NextResponse.json(
        {
          error: `Merge has ${outcome.conflicts.length} conflict${outcome.conflicts.length === 1 ? "" : "s"} — resolve and resubmit.`,
          conflicts: outcome.conflicts.map((c) => ({
            memory_id: c.memory_id,
            base: c.base ?? null,
            ours: c.ours ?? null,
            theirs: c.theirs ?? null,
            hunks_ours: diffMemoryText(c.base?.content ?? "", c.ours?.content ?? ""),
            hunks_theirs: diffMemoryText(c.base?.content ?? "", c.theirs?.content ?? ""),
          })),
        },
        { status: 409 }
      );
    }

    const loadLinks = async (branchId: string) => {
      const { data } = await admin
        .from("memory_links")
        .select("a_id, b_id, kind")
        .eq("user_id", userId)
        .eq("branch_id", branchId);
      return linksToState((data ?? []) as { a_id: string; b_id: string; kind: "manual" | "auto" }[]);
    };
    const [oursLinkState, theirsLinkState] = await Promise.all([loadLinks(target.id), loadLinks(source.id)]);
    let linkChanges = mergeLinkSets(linksToState(baseLinks), oursLinkState, theirsLinkState);

    const survives = new Set([...ours.keys(), ...theirs.keys()]);
    for (const change of outcome.changes) {
      if (change.op === "delete") survives.delete(change.memory_id);
    }
    linkChanges = linkChanges.filter(
      (l) => l.op === "remove" || (survives.has(l.a_id) && survives.has(l.b_id))
    );
    for (const change of outcome.changes) {
      if (change.op !== "delete") continue;
      for (const key of oursLinkState.keys()) {
        if (key.includes(change.memory_id)) {
          const [a_id, b_id] = key.split(":");
          if (!linkChanges.some((l) => linkKey(l.a_id, l.b_id) === key)) {
            linkChanges.push({ a_id, b_id, op: "remove", kind: oursLinkState.get(key) ?? "auto" });
          }
        }
      }
    }

    if (outcome.changes.length === 0 && linkChanges.length === 0) {
      return NextResponse.json({
        commit_id: null,
        merged: { created: 0, updated: 0, deleted: 0 },
        links_changed: 0,
        message: `Nothing to merge — ${targetName} already matches ${sourceName}.`,
      });
    }

    const message =
      (typeof body.message === "string" && body.message.trim()) || `merge ${sourceName} into ${targetName}`;

    const commitId = await recordCommit(admin, auth.identity, target.id, message, outcome.changes, linkChanges, {
      mergeParent: source.head_commit_id,
      expectedHead: target.head_commit_id ?? undefined,
    });

    const merged = { created: 0, updated: 0, deleted: 0 };
    for (const c of outcome.changes) {
      if (c.op === "create") merged.created++;
      else if (c.op === "update") merged.updated++;
      else merged.deleted++;
    }

    return NextResponse.json({
      commit_id: commitId,
      merged,
      links_changed: linkChanges.length,
      message: `Merged ${sourceName} into ${targetName}: ${merged.created} new, ${merged.updated} updated, ${merged.deleted} forgotten, ${linkChanges.length} link change${linkChanges.length === 1 ? "" : "s"}.`,
    });
  } catch (err) {
    if (err instanceof StaleHeadError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Merge failed." }, { status: 500 });
  }
}
