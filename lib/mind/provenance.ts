import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProvenanceReceipt } from "@/lib/mind/types";

export async function provenanceForMemories(
  db: SupabaseClient,
  userId: string,
  branchId: string,
  memoryIds: string[]
): Promise<Map<string, ProvenanceReceipt>> {
  const receipts = new Map<string, ProvenanceReceipt>();
  if (memoryIds.length === 0) return receipts;

  const { data: heads } = await db
    .from("memory_heads")
    .select("memory_id, revision_id")
    .eq("user_id", userId)
    .eq("branch_id", branchId)
    .in("memory_id", memoryIds);
  if (!heads || heads.length === 0) return receipts;

  const { data: revisions } = await db
    .from("memory_revisions")
    .select("id, memory_id, commit_id")
    .in("id", heads.map((h) => h.revision_id));
  if (!revisions || revisions.length === 0) return receipts;

  const { data: commits } = await db
    .from("memory_commits")
    .select("id, message, author_kind, author_key_id, created_at")
    .in("id", [...new Set(revisions.map((r) => r.commit_id))]);
  if (!commits || commits.length === 0) return receipts;

  const keyIds = [...new Set(commits.map((c) => c.author_key_id).filter(Boolean))] as string[];
  const prefixes = new Map<string, string>();
  if (keyIds.length > 0) {
    const { data: keys } = await db.from("api_keys").select("id, key_prefix").in("id", keyIds);
    for (const k of keys ?? []) prefixes.set(k.id, k.key_prefix);
  }

  const commitById = new Map(commits.map((c) => [c.id, c]));
  for (const rev of revisions) {
    const commit = commitById.get(rev.commit_id);
    if (!commit) continue;
    receipts.set(rev.memory_id, {
      commit_id: commit.id,
      message: commit.message,
      author_kind: commit.author_kind,
      author_key_prefix: commit.author_key_id ? prefixes.get(commit.author_key_id) : undefined,
      committed_at: commit.created_at,
    });
  }
  return receipts;
}
