import type { SupabaseClient } from "@supabase/supabase-js";
import {
  linkKey,
  type CommitRow,
  type LinkChangeRow,
  type LinkState,
  type MemorySnapshot,
  type MemoryState,
  type RevisionRow,
} from "@/lib/mind/types";


export type StateRow = MemorySnapshot & {
  revision_id: string;
  commit_id: string;
  committed_at: string;
};

export async function branchState(
  db: SupabaseClient,
  userId: string,
  branchId: string,
  q?: string
): Promise<StateRow[]> {
  const { data, error } = await db.rpc("mind_branch_state", {
    p_user: userId,
    p_branch: branchId,
    p_q: q && q.trim() ? q.trim() : null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as StateRow[];
}

export async function headSnapshot(
  db: SupabaseClient,
  userId: string,
  branchId: string,
  memoryId: string
): Promise<StateRow | null> {
  const { data: head, error } = await db
    .from("memory_heads")
    .select("revision_id")
    .eq("user_id", userId)
    .eq("branch_id", branchId)
    .eq("memory_id", memoryId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!head) return null;

  const { data: rev, error: revError } = await db
    .from("memory_revisions")
    .select("id, memory_id, title, content, summary, tags, source, commit_id, created_at")
    .eq("id", head.revision_id)
    .maybeSingle();
  if (revError) throw new Error(revError.message);
  if (!rev) return null;
  return {
    memory_id: rev.memory_id,
    revision_id: rev.id,
    title: rev.title,
    content: rev.content,
    summary: rev.summary,
    tags: rev.tags,
    source: rev.source,
    commit_id: rev.commit_id,
    committed_at: rev.created_at,
  };
}

export async function stateAt(db: SupabaseClient, userId: string, commitId: string): Promise<StateRow[]> {
  const { data, error } = await db.rpc("mind_state_at", { p_user: userId, p_commit: commitId });
  if (error) throw new Error(error.message);
  return (data ?? []) as StateRow[];
}

export async function linksAt(
  db: SupabaseClient,
  userId: string,
  commitId: string
): Promise<{ a_id: string; b_id: string; kind: "manual" | "auto" }[]> {
  const { data, error } = await db.rpc("mind_links_at", { p_user: userId, p_commit: commitId });
  if (error) throw new Error(error.message);
  return (data ?? []) as { a_id: string; b_id: string; kind: "manual" | "auto" }[];
}

export function rowsToState(rows: MemorySnapshot[]): MemoryState {
  return new Map(rows.map((r) => [r.memory_id, r]));
}

export function linksToState(rows: { a_id: string; b_id: string; kind: "manual" | "auto" }[]): LinkState {
  return new Map(rows.map((l) => [linkKey(l.a_id, l.b_id), l.kind]));
}

export function firstParentChain(commits: CommitRow[], from: string): string[] {
  const byId = new Map(commits.map((c) => [c.id, c]));
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = from;
  while (cursor && !seen.has(cursor)) {
    const commit = byId.get(cursor);
    if (!commit) break;
    chain.push(cursor);
    seen.add(cursor);
    cursor = commit.parent_commit_id;
  }
  return chain;
}

export function replayState(commits: CommitRow[], revisions: RevisionRow[], atCommitId: string): MemoryState {
  const chain = firstParentChain(commits, atCommitId);
  const depth = new Map(chain.map((id, i) => [id, i]));

  const nearest = new Map<string, RevisionRow>();
  for (const rev of revisions) {
    const d = depth.get(rev.commit_id);
    if (d === undefined) continue;
    const current = nearest.get(rev.memory_id);
    if (!current || d < (depth.get(current.commit_id) ?? Infinity)) {
      nearest.set(rev.memory_id, rev);
    }
  }

  const state: MemoryState = new Map();
  for (const [memoryId, rev] of nearest) {
    if (rev.op === "delete") continue;
    state.set(memoryId, {
      memory_id: memoryId,
      title: rev.title,
      content: rev.content,
      summary: rev.summary,
      tags: rev.tags,
      source: rev.source,
    });
  }
  return state;
}

export function replayLinks(commits: CommitRow[], linkChanges: LinkChangeRow[], atCommitId: string): LinkState {
  const chain = firstParentChain(commits, atCommitId);
  const depth = new Map(chain.map((id, i) => [id, i]));

  const nearest = new Map<string, LinkChangeRow>();
  for (const change of linkChanges) {
    const d = depth.get(change.commit_id);
    if (d === undefined) continue;
    const key = linkKey(change.a_id, change.b_id);
    const current = nearest.get(key);
    if (!current || d < (depth.get(current.commit_id) ?? Infinity)) {
      nearest.set(key, change);
    }
  }

  const links: LinkState = new Map();
  for (const [key, change] of nearest) {
    if (change.op === "add") links.set(key, change.kind);
  }
  return links;
}
