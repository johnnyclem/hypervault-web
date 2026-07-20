import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { resolveBranch } from "@/lib/mind/branches";
import { recordCommit } from "@/lib/mind/commits";
import { headSnapshot } from "@/lib/mind/state";
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

  const memoryId = typeof body.memory_id === "string" ? body.memory_id.trim() : "";
  const revisionId = typeof body.revision_id === "string" ? body.revision_id.trim() : "";
  if (!memoryId || !revisionId) {
    return NextResponse.json({ error: "memory_id and revision_id are required." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }
  const userId = auth.identity.userId;

  const branch = await resolveBranch(admin, userId, typeof body.branch === "string" ? body.branch : null);
  if (!branch) {
    return NextResponse.json({ error: "No such branch — create it first via /api/mind/branches." }, { status: 404 });
  }

  const { data: revision, error } = await admin
    .from("memory_revisions")
    .select("id, memory_id, title, content, summary, tags, source, op, created_at")
    .eq("id", revisionId)
    .eq("user_id", userId)
    .eq("memory_id", memoryId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!revision) return NextResponse.json({ error: "No such revision for that memory." }, { status: 404 });

  try {
    const current = await headSnapshot(admin, userId, branch.id, memoryId);
    const commitId = await recordCommit(
      admin,
      auth.identity,
      branch.id,
      `revert: restore "${revision.title}" to revision ${revision.id.slice(0, 8)}`,
      [
        {
          memory_id: memoryId,
          op: current ? "update" : "create",
          title: revision.title,
          content: revision.content,
          summary: revision.summary,
          tags: revision.tags,
          source: revision.source,
        },
      ]
    );
    return NextResponse.json({
      commit_id: commitId,
      restored: { memory_id: memoryId, title: revision.title, revision_id: revision.id },
      branch: branch.name,
      message: current
        ? `Restored "${revision.title}" to its ${new Date(revision.created_at).toLocaleDateString("en-US")} revision.`
        : `Unforgotten — "${revision.title}" is back in your wiki.`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not revert: ${err instanceof Error ? err.message : "commit failed"}` },
      { status: 500 }
    );
  }
}
