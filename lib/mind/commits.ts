import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiIdentity } from "@/lib/api-auth";
import type { LinkChange, MindChange } from "@/lib/mind/types";


export type CommitOptions = {
  mergeParent?: string;
  expectedHead?: string;
  authorKind?: "user" | "agent" | "system";
};

export async function recordCommit(
  db: SupabaseClient,
  identity: ApiIdentity,
  branchId: string,
  message: string,
  changes: MindChange[],
  linkChanges: LinkChange[] = [],
  opts: CommitOptions = {}
): Promise<string> {
  const authorKind = opts.authorKind ?? (identity.via === "api-key" ? "agent" : "user");
  const { data, error } = await db.rpc("mind_commit", {
    p_user: identity.userId,
    p_branch: branchId,
    p_message: message,
    p_author_kind: authorKind,
    p_author_key: identity.via === "api-key" ? (identity.keyId ?? null) : null,
    p_changes: changes.map((c) => ({
      memory_id: c.memory_id,
      op: c.op,
      title: c.title,
      content: c.content,
      summary: c.summary,
      tags: c.tags,
      source: c.source,
    })),
    p_link_changes: linkChanges,
    p_merge_parent: opts.mergeParent ?? null,
    p_expected_head: opts.expectedHead ?? null,
  });
  if (error) {
    if (error.message?.includes("stale head")) throw new StaleHeadError();
    throw new Error(`Commit failed: ${error.message}`);
  }
  return data as string;
}

export class StaleHeadError extends Error {
  constructor() {
    super("The branch moved while this change was being prepared — retry.");
  }
}

export type CommitLogEntry = {
  id: string;
  message: string;
  author_kind: "user" | "agent" | "system";
  author_key_id: string | null;
  parent_commit_id: string | null;
  merge_parent_commit_id: string | null;
  branch_id: string;
  created_at: string;
};

export async function commitLog(
  db: SupabaseClient,
  userId: string,
  headCommitId: string | null,
  limit = 50
): Promise<CommitLogEntry[]> {
  if (!headCommitId) return [];
  const { data, error } = await db
    .from("memory_commits")
    .select("id, message, author_kind, author_key_id, parent_commit_id, merge_parent_commit_id, branch_id, created_at")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  const byId = new Map((data ?? []).map((c) => [c.id, c as CommitLogEntry]));
  const log: CommitLogEntry[] = [];
  let cursor: string | null = headCommitId;
  while (cursor && log.length < limit) {
    const commit = byId.get(cursor);
    if (!commit) break;
    log.push(commit);
    cursor = commit.parent_commit_id;
  }
  return log;
}
