import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { resolveBranch } from "@/lib/mind/branches";
import { commitLog } from "@/lib/mind/commits";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_LOG = 200;

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }
  const userId = auth.identity.userId;

  const branch = await resolveBranch(admin, userId, req.nextUrl.searchParams.get("branch"));
  if (!branch) {
    return NextResponse.json({ error: "No such branch — create it first via /api/mind/branches." }, { status: 404 });
  }

  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 50, 1), MAX_LOG);

  try {
    const log = await commitLog(admin, userId, branch.head_commit_id, limit);
    const commitIds = log.map((c) => c.id);

    const changeCounts = new Map<string, { created: number; updated: number; deleted: number }>();
    const linkCounts = new Map<string, number>();
    if (commitIds.length > 0) {
      const { data: revisions } = await admin
        .from("memory_revisions")
        .select("commit_id, op")
        .in("commit_id", commitIds);
      for (const r of revisions ?? []) {
        const counts = changeCounts.get(r.commit_id) ?? { created: 0, updated: 0, deleted: 0 };
        if (r.op === "create") counts.created++;
        else if (r.op === "update") counts.updated++;
        else counts.deleted++;
        changeCounts.set(r.commit_id, counts);
      }
      const { data: linkChanges } = await admin
        .from("memory_link_changes")
        .select("commit_id")
        .in("commit_id", commitIds);
      for (const l of linkChanges ?? []) {
        linkCounts.set(l.commit_id, (linkCounts.get(l.commit_id) ?? 0) + 1);
      }
    }

    const keyIds = [...new Set(log.map((c) => c.author_key_id).filter(Boolean))] as string[];
    const prefixes = new Map<string, string>();
    if (keyIds.length > 0) {
      const { data: keys } = await admin.from("api_keys").select("id, key_prefix").in("id", keyIds);
      for (const k of keys ?? []) prefixes.set(k.id, k.key_prefix);
    }

    return NextResponse.json({
      branch: branch.name,
      commits: log.map((c) => ({
        id: c.id,
        message: c.message,
        author_kind: c.author_kind,
        author_key_prefix: c.author_key_id ? prefixes.get(c.author_key_id) : undefined,
        parent_commit_id: c.parent_commit_id,
        merge_parent_commit_id: c.merge_parent_commit_id,
        created_at: c.created_at,
        change_counts: {
          ...(changeCounts.get(c.id) ?? { created: 0, updated: 0, deleted: 0 }),
          links: linkCounts.get(c.id) ?? 0,
        },
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not read the log." }, { status: 500 });
  }
}
