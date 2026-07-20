import type { SupabaseClient } from "@supabase/supabase-js";
import type { BranchRow } from "@/lib/mind/branches";
import { branchState } from "@/lib/mind/state";
import type { LinkChange } from "@/lib/mind/types";


export type MemoryLite = {
  id: string;
  title: string;
  summary: string;
  tags: string[] | null;
};

export type MemoryLinkKind = "manual" | "auto";

const AUTO_LINK_CAP = 5;
const KEYWORD_OVERLAP_MIN = 2;
const MAX_AUTO_TAGS = 6;
const MAX_TITLE_CHARS = 80;
export const MAX_SUMMARY_CHARS = 280;

const STOPWORDS = new Set([
  "a", "about", "after", "all", "also", "an", "and", "any", "are", "asked",
  "back", "based", "be", "because", "been", "before", "being", "but", "can",
  "could", "did", "do", "does", "doing", "down", "each", "few", "for", "from",
  "get", "got", "had", "has", "have", "having", "her", "here", "him", "his",
  "how", "however", "i'm", "into", "it's", "its", "just", "let", "like",
  "made", "make", "many", "may", "me", "might", "more", "most", "much", "my",
  "need", "new", "not", "now", "of", "off", "on", "one", "only", "or",
  "other", "our", "out", "over", "own", "said", "same", "say", "see",
  "she", "should", "so", "some", "such", "than", "that", "the", "their",
  "them", "then", "there", "these", "they", "this", "those", "through",
  "to", "too", "under", "up", "us", "use", "used", "using", "very", "want",
  "was", "way", "we", "well", "were", "what", "when", "where", "which",
  "while", "who", "why", "will", "with", "would", "you", "your",
]);

export function memoryKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9'+#.-]+/)
    .map((w) => w.replace(/^[.'-]+|[.'-]+$/g, ""))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export function autoTitle(content: string): string {
  const line = content
    .split("\n")
    .map((l) => l.replace(/^[\s#>*•-]+/, "").trim())
    .find((l) => l.length > 0);
  if (!line) return "Untitled memory";
  if (line.length <= MAX_TITLE_CHARS) return line;
  const cut = line.slice(0, MAX_TITLE_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : MAX_TITLE_CHARS)}…`;
}

export function autoTags(content: string, title = ""): string[] {
  const words = memoryKeywords(`${title} ${title} ${content}`);
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);

  const repeated = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((x, y) => y[1] - x[1])
    .map(([w]) => w);

  const tags = repeated.slice(0, MAX_AUTO_TAGS);
  for (const w of words) {
    if (tags.length >= MAX_AUTO_TAGS) break;
    if (!tags.includes(w)) tags.push(w);
  }
  return tags;
}

export function summarize(content: string, maxChars = MAX_SUMMARY_CHARS): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;

  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let summary = "";
  for (const s of sentences) {
    if ((summary + s).length > maxChars) break;
    summary += s;
  }
  summary = summary.trim();
  if (summary) return summary;

  const cut = text.slice(0, maxChars - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 60))}…`;
}

export function scoreRecall(
  query: string,
  memory: { title: string; summary: string; tags: string[] | null; content?: string }
): number {
  const queryWords = new Set(memoryKeywords(query));
  if (queryWords.size === 0) return 0;

  const titleWords = new Set(memoryKeywords(memory.title));
  const summaryWords = new Set(memoryKeywords(memory.summary));
  const contentWords = new Set(memoryKeywords(memory.content ?? ""));
  const tags = new Set((memory.tags ?? []).map((t) => t.toLowerCase()));

  let score = 0;
  for (const w of queryWords) {
    if (titleWords.has(w)) score += 3;
    if (tags.has(w)) score += 3;
    if (summaryWords.has(w)) score += 2;
    else if (contentWords.has(w)) score += 1;
  }
  return score;
}

export function suggestMemoryLinks(
  memory: { id: string; title: string; summary: string; tags: string[] | null },
  candidates: MemoryLite[]
): string[] {
  const myTags = new Set((memory.tags ?? []).map((t) => t.toLowerCase()));
  const myWords = new Set(memoryKeywords(`${memory.title} ${memory.summary}`));

  const scored: { id: string; score: number }[] = [];
  for (const c of candidates) {
    if (c.id === memory.id) continue;
    let sharedTags = 0;
    for (const t of c.tags ?? []) if (myTags.has(t.toLowerCase())) sharedTags++;
    let sharedWords = 0;
    for (const w of new Set(memoryKeywords(`${c.title} ${c.summary}`))) {
      if (myWords.has(w)) sharedWords++;
    }
    if (sharedTags >= 1 || sharedWords >= KEYWORD_OVERLAP_MIN) {
      scored.push({ id: c.id, score: sharedTags * 2 + sharedWords });
    }
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, AUTO_LINK_CAP).map((s) => s.id);
}

export type ArtifactLite = {
  id: string;
  title: string;
  tags: string[] | null;
};

export function memoryArtifactAffinity(
  memory: { title: string; summary: string; tags: string[] | null },
  artifact: { title: string; tags: string[] | null }
): number {
  const myTags = new Set((memory.tags ?? []).map((t) => t.toLowerCase()));
  const myWords = new Set(memoryKeywords(`${memory.title} ${memory.summary}`));

  let sharedTags = 0;
  for (const t of artifact.tags ?? []) if (myTags.has(t.toLowerCase())) sharedTags++;
  let sharedWords = 0;
  for (const w of new Set(memoryKeywords(artifact.title))) {
    if (myWords.has(w) || myTags.has(w)) sharedWords++;
  }

  if (sharedTags < 1 && sharedWords < KEYWORD_OVERLAP_MIN) return 0;
  return sharedTags * 2 + sharedWords;
}

export function suggestArtifactLinks(
  memory: { title: string; summary: string; tags: string[] | null },
  artifacts: ArtifactLite[]
): string[] {
  return artifacts
    .map((a) => ({ id: a.id, score: memoryArtifactAffinity(memory, a) }))
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, AUTO_LINK_CAP)
    .map((s) => s.id);
}

export function suggestMemoriesForArtifact(
  artifact: { title: string; tags: string[] | null },
  memories: MemoryLite[]
): string[] {
  return memories
    .map((m) => ({
      id: m.id,
      score: memoryArtifactAffinity({ title: m.title, summary: m.summary, tags: m.tags }, artifact),
    }))
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, AUTO_LINK_CAP)
    .map((s) => s.id);
}

export async function createMemoryArtifactLinks(
  db: SupabaseClient,
  userId: string,
  pairs: { memoryId: string; artifactId: string }[],
  kind: MemoryLinkKind
): Promise<number> {
  const seen = new Set<string>();
  const rows = pairs
    .filter((p) => {
      if (!p.memoryId || !p.artifactId) return false;
      const key = `${p.memoryId}:${p.artifactId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p) => ({ user_id: userId, memory_id: p.memoryId, artifact_id: p.artifactId, kind }));
  if (rows.length === 0) return 0;

  const { error } = await db
    .from("memory_artifact_links")
    .upsert(rows, { onConflict: "memory_id,artifact_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return rows.length;
}

export async function syncArtifactLinksForMemory(
  db: SupabaseClient,
  userId: string,
  memory: { id: string; title: string; summary: string; tags: string[] | null }
): Promise<number> {
  const { data, error } = await db
    .from("artifacts")
    .select("id, title, tags")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  const artifactIds = suggestArtifactLinks(memory, (data ?? []) as ArtifactLite[]);
  return createMemoryArtifactLinks(
    db,
    userId,
    artifactIds.map((artifactId) => ({ memoryId: memory.id, artifactId })),
    "auto"
  );
}

export async function syncMemoryLinksForArtifact(
  db: SupabaseClient,
  userId: string,
  artifact: { id: string; title: string; tags: string[] | null }
): Promise<number> {
  const { data, error } = await db
    .from("memories")
    .select("id, title, summary, tags")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  const memoryIds = suggestMemoriesForArtifact(artifact, (data ?? []) as MemoryLite[]);
  return createMemoryArtifactLinks(
    db,
    userId,
    memoryIds.map((memoryId) => ({ memoryId, artifactId: artifact.id })),
    "auto"
  );
}

function pairKey(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

export function toLinkChanges(memoryId: string, targetIds: string[], kind: MemoryLinkKind): LinkChange[] {
  return [...new Set(targetIds)]
    .filter((t) => t && t !== memoryId)
    .map((t) => {
      const [a, b] = pairKey(memoryId, t);
      return { a_id: a, b_id: b, op: "add" as const, kind };
    });
}

export async function suggestLinkChangesForMemory(
  db: SupabaseClient,
  userId: string,
  branch: BranchRow,
  memory: { id: string; title: string; summary: string; tags: string[] | null }
): Promise<LinkChange[]> {
  let candidates: MemoryLite[];
  if (branch.is_default) {
    const { data, error } = await db
      .from("memories")
      .select("id, title, summary, tags")
      .eq("user_id", userId)
      .neq("id", memory.id)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    candidates = (data ?? []) as MemoryLite[];
  } else {
    const rows = await branchState(db, userId, branch.id);
    candidates = rows
      .filter((r) => r.memory_id !== memory.id)
      .map((r) => ({ id: r.memory_id, title: r.title, summary: r.summary, tags: r.tags }));
  }

  const autoIds = suggestMemoryLinks(memory, candidates);
  return toLinkChanges(memory.id, autoIds, "auto");
}
