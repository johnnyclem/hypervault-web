import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_HISTORY = 200;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }
  const userId = auth.identity.userId;

  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 50, 1), MAX_HISTORY);
  const full = req.nextUrl.searchParams.get("full") === "1";

  type RevisionRow = {
    id: string;
    op: string;
    title: string;
    summary: string;
    tags: string[];
    source: string;
    commit_id: string;
    created_at: string;
    content?: string;
  };
  const columns = full
    ? "id, op, title, summary, tags, source, commit_id, created_at, content"
    : "id, op, title, summary, tags, source, commit_id, created_at";
  const { data, error } = await admin
    .from("memory_revisions")
    .select(columns)
    .eq("user_id", userId)
    .eq("memory_id", id)
    .order("created_at", { ascending: false })
    .limit(limit);
  const revisions = (data ?? undefined) as RevisionRow[] | undefined;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!revisions || revisions.length === 0) {
    return NextResponse.json({ error: "No history for that memory." }, { status: 404 });
  }

  const commitIds = [...new Set(revisions.map((r) => r.commit_id))];
  const { data: commits } = await admin
    .from("memory_commits")
    .select("id, message, author_kind, author_key_id, branch_id, created_at")
    .in("id", commitIds);
  const commitById = new Map((commits ?? []).map((c) => [c.id, c]));

  const branchIds = [...new Set((commits ?? []).map((c) => c.branch_id))];
  const branchNames = new Map<string, string>();
  if (branchIds.length > 0) {
    const { data: branches } = await admin.from("memory_branches").select("id, name").in("id", branchIds);
    for (const b of branches ?? []) branchNames.set(b.id, b.name);
  }

  const keyIds = [...new Set((commits ?? []).map((c) => c.author_key_id).filter(Boolean))] as string[];
  const prefixes = new Map<string, string>();
  if (keyIds.length > 0) {
    const { data: keys } = await admin.from("api_keys").select("id, key_prefix").in("id", keyIds);
    for (const k of keys ?? []) prefixes.set(k.id, k.key_prefix);
  }

  return NextResponse.json({
    memory_id: id,
    revisions: revisions.map((r) => {
      const commit = commitById.get(r.commit_id);
      return {
        revision_id: r.id,
        op: r.op,
        title: r.title,
        summary: r.summary,
        tags: r.tags,
        source: r.source,
        content: full ? r.content : undefined,
        commit: commit
          ? {
              id: commit.id,
              message: commit.message,
              author_kind: commit.author_kind,
              author_key_prefix: commit.author_key_id ? prefixes.get(commit.author_key_id) : undefined,
              branch: branchNames.get(commit.branch_id),
              created_at: commit.created_at,
            }
          : null,
      };
    }),
  });
}
