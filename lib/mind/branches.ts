import type { SupabaseClient } from "@supabase/supabase-js";


export const DEFAULT_BRANCH = "main";
export const BRANCH_NAME_RE = /^[a-z0-9][a-z0-9/_-]{0,62}$/;

export type BranchRow = {
  id: string;
  user_id: string;
  name: string;
  is_default: boolean;
  created_from_commit_id: string | null;
  head_commit_id: string | null;
  created_at: string;
};

const BRANCH_COLUMNS = "id, user_id, name, is_default, created_from_commit_id, head_commit_id, created_at";

export async function ensureMainBranch(db: SupabaseClient, userId: string): Promise<BranchRow> {
  const existing = await getBranchByName(db, userId, DEFAULT_BRANCH);
  if (existing) return existing;

  const { data, error } = await db
    .from("memory_branches")
    .upsert(
      { user_id: userId, name: DEFAULT_BRANCH, is_default: true },
      { onConflict: "user_id,name", ignoreDuplicates: false }
    )
    .select(BRANCH_COLUMNS)
    .single();
  if (error || !data) throw new Error(`Could not create the main branch: ${error?.message ?? "upsert failed"}`);
  return data as BranchRow;
}

export async function resolveBranch(
  db: SupabaseClient,
  userId: string,
  name: string | null | undefined
): Promise<BranchRow | null> {
  if (!name || name === DEFAULT_BRANCH) return ensureMainBranch(db, userId);
  return getBranchByName(db, userId, name);
}

export async function getBranchByName(
  db: SupabaseClient,
  userId: string,
  name: string
): Promise<BranchRow | null> {
  const { data, error } = await db
    .from("memory_branches")
    .select(BRANCH_COLUMNS)
    .eq("user_id", userId)
    .eq("name", name)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BranchRow) ?? null;
}

export async function getBranchById(
  db: SupabaseClient,
  userId: string,
  id: string
): Promise<BranchRow | null> {
  const { data, error } = await db
    .from("memory_branches")
    .select(BRANCH_COLUMNS)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BranchRow) ?? null;
}

export async function listBranches(db: SupabaseClient, userId: string): Promise<BranchRow[]> {
  const { data, error } = await db
    .from("memory_branches")
    .select(BRANCH_COLUMNS)
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BranchRow[];
}

export async function createBranch(
  db: SupabaseClient,
  userId: string,
  name: string,
  from: BranchRow
): Promise<BranchRow> {
  const { data: branch, error } = await db
    .from("memory_branches")
    .insert({
      user_id: userId,
      name,
      is_default: false,
      created_from_commit_id: from.head_commit_id,
      head_commit_id: from.head_commit_id,
    })
    .select(BRANCH_COLUMNS)
    .single();
  if (error || !branch) {
    if (error?.code === "23505") throw new BranchExistsError(name);
    throw new Error(`Could not create branch: ${error?.message ?? "insert failed"}`);
  }

  const { data: heads, error: headsError } = await db
    .from("memory_heads")
    .select("memory_id, revision_id")
    .eq("branch_id", from.id)
    .eq("user_id", userId);
  if (headsError) throw new Error(headsError.message);
  if (heads && heads.length > 0) {
    const { error: copyError } = await db.from("memory_heads").insert(
      heads.map((h) => ({ user_id: userId, branch_id: branch.id, memory_id: h.memory_id, revision_id: h.revision_id }))
    );
    if (copyError) throw new Error(copyError.message);
  }

  const { data: links, error: linksError } = await db
    .from("memory_links")
    .select("a_id, b_id, kind")
    .eq("branch_id", from.id)
    .eq("user_id", userId);
  if (linksError) throw new Error(linksError.message);
  if (links && links.length > 0) {
    const { error: copyError } = await db.from("memory_links").insert(
      links.map((l) => ({ user_id: userId, branch_id: branch.id, a_id: l.a_id, b_id: l.b_id, kind: l.kind }))
    );
    if (copyError) throw new Error(copyError.message);
  }

  return branch as BranchRow;
}

export class BranchExistsError extends Error {
  constructor(name: string) {
    super(`A branch named "${name}" already exists.`);
  }
}

export async function deleteBranch(db: SupabaseClient, userId: string, branch: BranchRow): Promise<void> {
  if (branch.is_default) throw new Error("The default branch cannot be deleted.");
  const { error } = await db.from("memory_branches").delete().eq("id", branch.id).eq("user_id", userId);
  if (error) {
    if (error.code === "23503") {
      throw new BranchInUseError(branch.name);
    }
    throw new Error(error.message);
  }
}

export class BranchInUseError extends Error {
  constructor(name: string) {
    super(`Branch "${name}" still has branches forked from it — delete or merge those first.`);
  }
}
