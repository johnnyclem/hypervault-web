import type { SupabaseClient } from "@supabase/supabase-js";
import {
  backfillEmbeddingsBestEffort,
  embedTexts,
  getEmbeddingBackend,
} from "@/lib/backends/embeddings";
import { scoreRecall } from "@/lib/memory";
import { branchState } from "@/lib/mind/state";
import { polyticianRerank } from "@/lib/polytician/client";


export type RecallMemoryRow = {
  id: string;
  title: string;
  summary: string;
  tags: string[] | null;
  source: string;
  content: string;
  created_at: string;
};

export type RankedMemory = { memory: RecallMemoryRow; score: number };

export type RecallMode = "lexical" | "hybrid" | "hybrid-local";

export type HybridRecall = {
  mode: RecallMode;
  ranked: RankedMemory[];
};

export type HybridRecallOptions = {
  polyticianRerank?: boolean;
};

const RRF_K = 60;
const FTS_BONUS = 2;
const FTS_LIMIT = 100;
const RECENT_LIMIT = 300;
const SEMANTIC_LIMIT = 50;
const LOCAL_RERANK_LIMIT = 50;
const MEMORY_COLUMNS = "id, title, summary, tags, source, content, created_at";

export function fuseRecallRankings(
  lexScored: { id: string; score: number }[],
  semanticRank: Map<string, number>
): Map<string, number> {
  const lexRank = new Map<string, number>();
  lexScored.filter((r) => r.score > 0).forEach((r, i) => lexRank.set(r.id, i));

  const fused = new Map<string, number>();
  const ids = new Set<string>([...lexScored.map((r) => r.id), ...semanticRank.keys()]);
  for (const id of ids) {
    const lex = lexRank.get(id);
    const sem = semanticRank.get(id);
    const score =
      (lex !== undefined ? 1 / (RRF_K + lex) : 0) + (sem !== undefined ? 1 / (RRF_K + sem) : 0);
    fused.set(id, Math.round(score * 10_000) / 100);
  }
  return fused;
}

export async function hybridRecallMemories(
  db: SupabaseClient,
  userId: string,
  q: string,
  limit: number,
  opts: HybridRecallOptions = {}
): Promise<HybridRecall> {
  const byId = new Map<string, RecallMemoryRow>();
  const ftsIds = new Set<string>();

  const [{ data: ftsRows }, { data: recentRows, error: recentError }] = await Promise.all([
    db
      .from("memories")
      .select(MEMORY_COLUMNS)
      .eq("user_id", userId)
      .textSearch("search", q, { type: "websearch", config: "english" })
      .limit(FTS_LIMIT),
    db
      .from("memories")
      .select(MEMORY_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT),
  ]);
  if (recentError && !ftsRows) throw new Error(recentError.message);

  for (const row of [...(ftsRows ?? []), ...(recentRows ?? [])] as RecallMemoryRow[]) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  for (const row of ftsRows ?? []) ftsIds.add(row.id);

  let mode: RecallMode = "lexical";
  const semanticRank = new Map<string, number>();
  try {
    const backend = await getEmbeddingBackend(db, userId);
    if (backend) {
      await backfillEmbeddingsBestEffort(db, userId, backend);
      const vectors = await embedTexts(backend, [q]);
      const queryVector = vectors?.[0];
      if (queryVector) {
        const { data: semantic } = await db.rpc("mind_semantic_recall", {
          p_user: userId,
          p_embedding: JSON.stringify(queryVector),
          p_model: backend.model,
          p_limit: SEMANTIC_LIMIT,
        });
        const semanticRows = (semantic ?? []) as { id: string; distance: number }[];
        if (semanticRows.length > 0) {
          mode = "hybrid";
          semanticRows.forEach((row, i) => semanticRank.set(row.id, i));
          const missing = semanticRows.map((r) => r.id).filter((id) => !byId.has(id));
          if (missing.length > 0) {
            const { data: extra } = await db
              .from("memories")
              .select(MEMORY_COLUMNS)
              .eq("user_id", userId)
              .in("id", missing);
            for (const row of (extra ?? []) as RecallMemoryRow[]) byId.set(row.id, row);
          }
        }
      }
    }
  } catch {
  }

  const lexScored = [...byId.values()]
    .map((m) => ({ memory: m, score: scoreRecall(q, m) + (ftsIds.has(m.id) ? FTS_BONUS : 0) }))
    .sort((x, y) => y.score - x.score);

  if (mode === "hybrid") {
    const fused = fuseRecallRankings(
      lexScored.map((r) => ({ id: r.memory.id, score: r.score })),
      semanticRank
    );
    return {
      mode,
      ranked: lexScored
        .map(({ memory }) => ({ memory, score: fused.get(memory.id) ?? 0 }))
        .filter((r) => r.score > 0)
        .sort((x, y) => y.score - x.score)
        .slice(0, limit),
    };
  }

  if (opts.polyticianRerank) {
    const positive = lexScored.filter((r) => r.score > 0);
    const pool = (positive.length > 0 ? positive : lexScored).slice(0, LOCAL_RERANK_LIMIT);
    const localRank = await polyticianRerank(
      q,
      pool.map((r) => ({ id: r.memory.id, text: `${r.memory.title}\n${r.memory.summary}` }))
    );
    if (localRank && localRank.size > 0) {
      const fused = fuseRecallRankings(
        lexScored.map((r) => ({ id: r.memory.id, score: r.score })),
        localRank
      );
      return {
        mode: "hybrid-local",
        ranked: lexScored
          .map(({ memory }) => ({ memory, score: fused.get(memory.id) ?? 0 }))
          .filter((r) => r.score > 0)
          .sort((x, y) => y.score - x.score)
          .slice(0, limit),
      };
    }
  }

  return { mode, ranked: lexScored.filter((r) => r.score > 0).slice(0, limit) };
}

export async function branchRecallMemories(
  db: SupabaseClient,
  userId: string,
  branchId: string,
  q: string,
  limit: number
): Promise<HybridRecall> {
  const byId = new Map<string, RecallMemoryRow>();
  const ftsIds = new Set<string>();

  const [ftsRows, allRows] = await Promise.all([
    branchState(db, userId, branchId, q),
    branchState(db, userId, branchId),
  ]);
  for (const r of [...ftsRows, ...allRows]) {
    if (!byId.has(r.memory_id)) {
      byId.set(r.memory_id, {
        id: r.memory_id,
        title: r.title,
        summary: r.summary,
        tags: r.tags,
        source: r.source,
        content: r.content,
        created_at: r.committed_at,
      });
    }
  }
  for (const r of ftsRows) ftsIds.add(r.memory_id);

  const ranked = [...byId.values()]
    .map((m) => ({ memory: m, score: scoreRecall(q, m) + (ftsIds.has(m.id) ? FTS_BONUS : 0) }))
    .filter((r) => r.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);

  return { mode: "lexical", ranked };
}
