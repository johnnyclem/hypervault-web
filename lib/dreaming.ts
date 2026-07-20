import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiIdentity } from "@/lib/api-auth";
import { createConnections, titleKeywords } from "@/lib/connections";
import { createMemoryArtifactLinks, memoryKeywords, toLinkChanges } from "@/lib/memory";
import { ensureMainBranch, getBranchByName } from "@/lib/mind/branches";
import { recordCommit } from "@/lib/mind/commits";


export type DreamEdgeType = "artifact_artifact" | "memory_memory" | "memory_artifact";

export type ArtifactLite = { id: string; title: string; tags: string[] | null };
export type MemoryLite = { id: string; title: string; summary: string; tags: string[] | null };

export type DreamCandidate = {
  edge_type: DreamEdgeType;
  a_id: string;
  b_id: string;
  score: number;
  reason: string;
};

const KEYWORD_OVERLAP_MIN = 2;
export const DREAM_CAP_PER_TYPE = 8;
export const DREAM_CAP_TOTAL = 24;

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function describeOverlap(sharedTags: string[], sharedWords: string[]): string {
  const parts: string[] = [];
  if (sharedTags.length) {
    parts.push(`shared tag${sharedTags.length > 1 ? "s" : ""}: ${sharedTags.slice(0, 3).join(", ")}`);
  }
  if (sharedWords.length) {
    parts.push(`common ${sharedWords.length > 1 ? "themes" : "theme"}: ${sharedWords.slice(0, 3).join(", ")}`);
  }
  return parts.join(" · ") || "related";
}

function symmetricOverlap(
  aTags: Set<string>,
  aWords: Set<string>,
  bTags: Set<string>,
  bWords: Set<string>
): { score: number; sharedTags: string[]; sharedWords: string[] } | null {
  const sharedTags: string[] = [];
  for (const t of aTags) if (bTags.has(t)) sharedTags.push(t);
  const sharedWords: string[] = [];
  for (const w of aWords) if (bWords.has(w)) sharedWords.push(w);
  if (sharedTags.length < 1 && sharedWords.length < KEYWORD_OVERLAP_MIN) return null;
  return { score: sharedTags.length * 2 + sharedWords.length, sharedTags, sharedWords };
}

function lowerTagSet(tags: string[] | null): Set<string> {
  return new Set((tags ?? []).map((t) => t.toLowerCase()));
}

function artifactCandidates(
  artifacts: ArtifactLite[],
  existingPairs: Set<string>,
  proposed: Set<string>
): DreamCandidate[] {
  const profs = artifacts.map((a) => ({
    id: a.id,
    tags: lowerTagSet(a.tags),
    words: titleKeywords(a.title),
  }));
  const out: DreamCandidate[] = [];
  for (let i = 0; i < profs.length; i++) {
    for (let j = i + 1; j < profs.length; j++) {
      const A = profs[i];
      const B = profs[j];
      const o = symmetricOverlap(A.tags, A.words, B.tags, B.words);
      if (!o) continue;
      const [a_id, b_id] = A.id < B.id ? [A.id, B.id] : [B.id, A.id];
      if (existingPairs.has(pairKey(a_id, b_id))) continue;
      if (proposed.has(`artifact_artifact:${a_id}:${b_id}`)) continue;
      out.push({ edge_type: "artifact_artifact", a_id, b_id, score: o.score, reason: describeOverlap(o.sharedTags, o.sharedWords) });
    }
  }
  return out;
}

function memoryCandidates(
  memories: MemoryLite[],
  existingPairs: Set<string>,
  proposed: Set<string>
): DreamCandidate[] {
  const profs = memories.map((m) => ({
    id: m.id,
    tags: lowerTagSet(m.tags),
    words: new Set(memoryKeywords(`${m.title} ${m.summary}`)),
  }));
  const out: DreamCandidate[] = [];
  for (let i = 0; i < profs.length; i++) {
    for (let j = i + 1; j < profs.length; j++) {
      const A = profs[i];
      const B = profs[j];
      const o = symmetricOverlap(A.tags, A.words, B.tags, B.words);
      if (!o) continue;
      const [a_id, b_id] = A.id < B.id ? [A.id, B.id] : [B.id, A.id];
      if (existingPairs.has(pairKey(a_id, b_id))) continue;
      if (proposed.has(`memory_memory:${a_id}:${b_id}`)) continue;
      out.push({ edge_type: "memory_memory", a_id, b_id, score: o.score, reason: describeOverlap(o.sharedTags, o.sharedWords) });
    }
  }
  return out;
}

function memoryArtifactCandidates(
  memories: MemoryLite[],
  artifacts: ArtifactLite[],
  existing: Set<string>,
  proposed: Set<string>
): DreamCandidate[] {
  const artProfs = artifacts.map((a) => ({
    id: a.id,
    tags: lowerTagSet(a.tags),
    titleWords: new Set(memoryKeywords(a.title)),
  }));
  const out: DreamCandidate[] = [];
  for (const m of memories) {
    const mTags = lowerTagSet(m.tags);
    const mWords = new Set(memoryKeywords(`${m.title} ${m.summary}`));
    for (const a of artProfs) {
      const sharedTags: string[] = [];
      for (const t of mTags) if (a.tags.has(t)) sharedTags.push(t);
      const sharedWords: string[] = [];
      for (const w of a.titleWords) if (mWords.has(w) || mTags.has(w)) sharedWords.push(w);
      if (sharedTags.length < 1 && sharedWords.length < KEYWORD_OVERLAP_MIN) continue;
      if (existing.has(`${m.id}:${a.id}`)) continue;
      if (proposed.has(`memory_artifact:${m.id}:${a.id}`)) continue;
      out.push({
        edge_type: "memory_artifact",
        a_id: m.id,
        b_id: a.id,
        score: sharedTags.length * 2 + sharedWords.length,
        reason: describeOverlap(sharedTags, sharedWords),
      });
    }
  }
  return out;
}

function topN(candidates: DreamCandidate[], n: number): DreamCandidate[] {
  return [...candidates].sort((x, y) => y.score - x.score).slice(0, n);
}

export type ExistingEdges = {
  artifactPairs: Set<string>;
  memoryPairs: Set<string>;
  memoryArtifactPairs: Set<string>;
  proposed: Set<string>;
};

export function findDreamConnections(input: {
  artifacts: ArtifactLite[];
  memories: MemoryLite[];
  existing: ExistingEdges;
  capPerType?: number;
  capTotal?: number;
}): DreamCandidate[] {
  const capPer = input.capPerType ?? DREAM_CAP_PER_TYPE;
  const capTot = input.capTotal ?? DREAM_CAP_TOTAL;
  const aa = topN(artifactCandidates(input.artifacts, input.existing.artifactPairs, input.existing.proposed), capPer);
  const mm = topN(memoryCandidates(input.memories, input.existing.memoryPairs, input.existing.proposed), capPer);
  const ma = topN(
    memoryArtifactCandidates(input.memories, input.artifacts, input.existing.memoryArtifactPairs, input.existing.proposed),
    capPer
  );
  return topN([...aa, ...mm, ...ma], capTot);
}

export type DreamRunSummary = {
  runId: string | null;
  counts: { artifact_artifact: number; memory_memory: number; memory_artifact: number; total: number };
};

const EMPTY_COUNTS = { artifact_artifact: 0, memory_memory: 0, memory_artifact: 0, total: 0 } as const;

export async function generateDreamsForUser(db: SupabaseClient, userId: string): Promise<DreamRunSummary> {
  const [
    { data: artifacts },
    { data: memories },
    { data: connections },
    { data: maLinks },
    { data: proposedRows },
    mainBranch,
  ] = await Promise.all([
    db.from("artifacts").select("id, title, tags").eq("user_id", userId).order("created_at", { ascending: false }).limit(1000),
    db.from("memories").select("id, title, summary, tags").eq("user_id", userId).order("created_at", { ascending: false }).limit(1000),
    db.from("connections").select("a_id, b_id").eq("user_id", userId).limit(5000),
    db.from("memory_artifact_links").select("memory_id, artifact_id").eq("user_id", userId).limit(5000),
    db.from("dream_connections").select("edge_type, a_id, b_id").eq("user_id", userId).limit(10000),
    getBranchByName(db, userId, "main").catch(() => null),
  ]);

  let memoryLinks: { a_id: string; b_id: string }[] = [];
  if (mainBranch) {
    const { data } = await db
      .from("memory_links")
      .select("a_id, b_id")
      .eq("user_id", userId)
      .eq("branch_id", mainBranch.id)
      .limit(5000);
    memoryLinks = (data ?? []) as { a_id: string; b_id: string }[];
  }

  const existing: ExistingEdges = {
    artifactPairs: new Set((connections ?? []).map((c) => pairKey(c.a_id, c.b_id))),
    memoryPairs: new Set(memoryLinks.map((l) => pairKey(l.a_id, l.b_id))),
    memoryArtifactPairs: new Set((maLinks ?? []).map((l) => `${l.memory_id}:${l.artifact_id}`)),
    proposed: new Set((proposedRows ?? []).map((r) => `${r.edge_type}:${r.a_id}:${r.b_id}`)),
  };

  const candidates = findDreamConnections({
    artifacts: (artifacts ?? []) as ArtifactLite[],
    memories: (memories ?? []) as MemoryLite[],
    existing,
  });

  await db.from("profiles").update({ dreaming_last_run_at: new Date().toISOString() }).eq("id", userId);

  if (candidates.length === 0) return { runId: null, counts: { ...EMPTY_COUNTS } };

  const { data: run, error: runErr } = await db
    .from("dream_runs")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (runErr || !run) throw new Error(`Could not open a dream run: ${runErr?.message ?? "insert failed"}`);

  const rows = candidates.map((c) => ({
    user_id: userId,
    run_id: run.id,
    edge_type: c.edge_type,
    a_id: c.a_id,
    b_id: c.b_id,
    score: c.score,
    reason: c.reason,
  }));
  const { error: connErr } = await db.from("dream_connections").insert(rows);
  if (connErr) {
    await db.from("dream_runs").delete().eq("id", run.id);
    throw new Error(`Could not stage dream connections: ${connErr.message}`);
  }

  return {
    runId: run.id as string,
    counts: {
      artifact_artifact: candidates.filter((c) => c.edge_type === "artifact_artifact").length,
      memory_memory: candidates.filter((c) => c.edge_type === "memory_memory").length,
      memory_artifact: candidates.filter((c) => c.edge_type === "memory_artifact").length,
      total: candidates.length,
    },
  };
}

export async function applyDreamConnection(
  db: SupabaseClient,
  identity: ApiIdentity,
  dream: { edge_type: DreamEdgeType; a_id: string; b_id: string }
): Promise<void> {
  const userId = identity.userId;
  if (dream.edge_type === "artifact_artifact") {
    await createConnections(db, userId, dream.a_id, [dream.b_id], "auto");
  } else if (dream.edge_type === "memory_memory") {
    const branch = await ensureMainBranch(db, userId);
    await recordCommit(db, identity, branch.id, "dream: connect two memories", [], toLinkChanges(dream.a_id, [dream.b_id], "auto"));
  } else {
    await createMemoryArtifactLinks(db, userId, [{ memoryId: dream.a_id, artifactId: dream.b_id }], "auto");
  }
}
