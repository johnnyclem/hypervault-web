import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createBranch,
  ensureMainBranch,
  getBranchByName,
  type BranchRow,
} from "@/lib/mind/branches";
import type { PolyticianConceptRow } from "@/lib/polytician/bridge";


export async function ensurePolyticianBranch(
  db: SupabaseClient,
  userId: string,
  name: string
): Promise<BranchRow> {
  const existing = await getBranchByName(db, userId, name);
  if (existing) return existing;
  const main = await ensureMainBranch(db, userId);
  if (name === main.name) return main;
  return createBranch(db, userId, name, main);
}

export async function loadConceptRowsByMemory(
  db: SupabaseClient,
  userId: string,
  memoryIds: string[]
): Promise<Map<string, PolyticianConceptRow>> {
  const map = new Map<string, PolyticianConceptRow>();
  if (memoryIds.length === 0) return map;
  const { data, error } = await db
    .from("polytician_concepts")
    .select("memory_id, concept_id, namespace, version, thoughtform, updated_at_ms")
    .eq("user_id", userId)
    .in("memory_id", memoryIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as PolyticianConceptRow[]) map.set(row.memory_id, row);
  return map;
}

export async function getConceptById(
  db: SupabaseClient,
  userId: string,
  conceptId: string
): Promise<PolyticianConceptRow | null> {
  const { data, error } = await db
    .from("polytician_concepts")
    .select("memory_id, concept_id, namespace, version, thoughtform, updated_at_ms")
    .eq("user_id", userId)
    .eq("concept_id", conceptId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PolyticianConceptRow) ?? null;
}

export type ConceptUpsert = {
  memoryId: string;
  conceptId: string;
  namespace: string;
  version: number;
  updatedAtMs: number;
  thoughtform?: unknown | null;
};

export async function upsertConcept(
  db: SupabaseClient,
  userId: string,
  c: ConceptUpsert
): Promise<void> {
  const row: Record<string, unknown> = {
    user_id: userId,
    memory_id: c.memoryId,
    concept_id: c.conceptId,
    namespace: c.namespace,
    version: c.version,
    updated_at_ms: c.updatedAtMs,
    updated_at: new Date().toISOString(),
  };
  if (c.thoughtform !== undefined) row.thoughtform = c.thoughtform;
  const { error } = await db
    .from("polytician_concepts")
    .upsert(row, { onConflict: "user_id,concept_id" });
  if (error) throw new Error(error.message);
}

export async function clearConceptThoughtform(
  db: SupabaseClient,
  userId: string,
  conceptId: string
): Promise<void> {
  const { error } = await db
    .from("polytician_concepts")
    .update({ thoughtform: null, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("concept_id", conceptId);
  if (error) throw new Error(error.message);
}

export async function deleteConcept(
  db: SupabaseClient,
  userId: string,
  conceptId: string
): Promise<void> {
  const { error } = await db
    .from("polytician_concepts")
    .delete()
    .eq("user_id", userId)
    .eq("concept_id", conceptId);
  if (error) throw new Error(error.message);
}
