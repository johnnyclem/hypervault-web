import type { SupabaseClient } from "@supabase/supabase-js";
import { getBranchByName, type BranchRow } from "@/lib/mind/branches";


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolvedRef = {
  commitId: string;
  branch?: BranchRow;
};

export async function resolveRef(
  db: SupabaseClient,
  userId: string,
  ref: string,
  opts: { branchHint?: BranchRow } = {}
): Promise<ResolvedRef | null> {
  const trimmed = ref.trim();
  if (!trimmed) return null;

  if (UUID_RE.test(trimmed)) {
    const { data, error } = await db
      .from("memory_commits")
      .select("id")
      .eq("id", trimmed)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { commitId: data.id } : null;
  }

  const branch = await getBranchByName(db, userId, trimmed);
  if (branch) {
    return branch.head_commit_id ? { commitId: branch.head_commit_id, branch } : null;
  }

  const at = new Date(trimmed);
  if (!Number.isNaN(at.getTime())) {
    return resolveTimestamp(db, userId, at, opts.branchHint);
  }

  return null;
}

async function resolveTimestamp(
  db: SupabaseClient,
  userId: string,
  at: Date,
  branchHint?: BranchRow
): Promise<ResolvedRef | null> {
  const branch = branchHint ?? (await getBranchByName(db, userId, "main"));
  if (!branch?.head_commit_id) return null;

  const { data, error } = await db
    .from("memory_commits")
    .select("id, parent_commit_id, created_at")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  const byId = new Map((data ?? []).map((c) => [c.id, c]));
  let cursor: string | null = branch.head_commit_id;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const commit = byId.get(cursor);
    if (!commit) break;
    if (new Date(commit.created_at).getTime() <= at.getTime()) {
      return { commitId: commit.id, branch };
    }
    cursor = commit.parent_commit_id;
  }
  return null;
}
