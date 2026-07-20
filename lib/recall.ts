import type { SupabaseClient } from "@supabase/supabase-js";
import { titleKeywords } from "@/lib/connections";
import { memoryKeywords } from "@/lib/memory";
import { branchRecallMemories, hybridRecallMemories } from "@/lib/memory-recall";
import { appUrl } from "@/lib/utils";


const MAX_RECALLED = 4;
const MAX_RECALLED_MEMORIES = 4;
const MAX_SNIPPET_CHARS = 600;

const MEMORY_CONTEXT_BUDGET_CHARS = 16_000;
const MAX_MEMORY_EXCERPT_CHARS = 6_000;
const MIN_USEFUL_EXCERPT_CHARS = 200;
const EXCERPT_BLOCK_CHARS = 700;
const OMISSION_MARK = "[…]";

const THIN_QUERY_KEYWORDS = 5;
const RICH_QUERY_KEYWORDS = 12;
const MAX_QUERY_CONTEXT_CHARS = 1_500;

const NUMBER_REF_MAX_SPAN = 500;
const BRACKETED_REF_SCORE = 40;
const BARE_REF_SCORE = 10;

export type RecalledArtifact = {
  title: string;
  slug: string;
  tags: string[];
  source_prompt: string | null;
};

export async function recallArtifacts(
  db: SupabaseClient,
  userId: string,
  query: string
): Promise<RecalledArtifact[]> {
  const keywords = titleKeywords(query);
  if (keywords.size === 0) return [];

  const { data: artifacts } = await db
    .from("artifacts")
    .select("title, slug, tags, source_prompt")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(500);

  const scored = (artifacts ?? [])
    .map((a) => {
      const words = new Set([...titleKeywords(a.title), ...(a.tags ?? []).map((t: string) => t.toLowerCase())]);
      let score = 0;
      for (const k of keywords) if (words.has(k)) score++;
      return { artifact: a as RecalledArtifact, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, MAX_RECALLED).map((s) => s.artifact);
}

export type RecalledMemory = {
  title: string;
  summary: string;
  content: string;
  tags: string[] | null;
  excerpt: string;
};

export function buildRecallQuery(
  message: string,
  history: { role: string; content: string }[]
): string {
  const keywords = new Set(memoryKeywords(message));
  if (keywords.size >= THIN_QUERY_KEYWORDS) return message;

  const borrowed: string[] = [];
  let remaining = MAX_QUERY_CONTEXT_CHARS;
  for (let i = history.length - 1; i >= 0 && remaining > 0; i--) {
    const text = typeof history[i]?.content === "string" ? history[i].content.trim() : "";
    if (!text) continue;
    const slice = text.slice(0, remaining);
    borrowed.push(slice);
    remaining -= slice.length;
    for (const k of memoryKeywords(slice)) keywords.add(k);
    if (keywords.size >= RICH_QUERY_KEYWORDS) break;
  }
  return borrowed.length > 0 ? `${message}\n${borrowed.join("\n")}` : message;
}

export function queryNumberRefs(query: string): Set<string> {
  const refs = new Set<string>();
  const rangeRe = /\b(\d{1,6})\s*(?:[-–—]|to|through)\s*(\d{1,6})\b/gi;
  for (const m of query.matchAll(rangeRe)) {
    const lo = parseInt(m[1], 10);
    const hi = parseInt(m[2], 10);
    if (hi < lo) continue;
    if (hi - lo <= NUMBER_REF_MAX_SPAN) {
      for (let n = lo; n <= hi; n++) refs.add(String(n));
    } else {
      refs.add(String(lo));
      refs.add(String(hi));
    }
  }
  for (const m of query.matchAll(/\b\d{1,6}\b/g)) refs.add(m[0]);
  return refs;
}

function scoreNumberRefs(block: string, refs: Set<string>): number {
  if (refs.size === 0) return 0;
  let score = 0;
  const bracketed = new Set<string>();
  for (const m of block.matchAll(/\[(\d{1,6})\]/g)) bracketed.add(m[1]);
  const bare = new Set<string>();
  for (const m of block.matchAll(/\b\d{1,6}\b/g)) bare.add(m[0]);
  for (const ref of refs) {
    if (bracketed.has(ref)) score += BRACKETED_REF_SCORE;
    else if (bare.has(ref)) score += BARE_REF_SCORE;
  }
  return score;
}

function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current && current.length + line.length + 1 > EXCERPT_BLOCK_CHARS) {
      blocks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current.trim()) blocks.push(current);
  return blocks;
}

export function excerptMemory(content: string, query: string, budget: number): string {
  const text = content.trim();
  if (text.length <= budget) return text;

  const keywords = memoryKeywords(query);
  const numberRefs = queryNumberRefs(query);
  const blocks = splitBlocks(text);

  const scored = blocks.map((block, index) => {
    const words = memoryKeywords(block);
    const distinct = new Set(words);
    let score = scoreNumberRefs(block, numberRefs);
    for (const k of keywords) {
      if (!distinct.has(k)) continue;
      score += 5;
      for (const w of words) if (w === k) score += 1;
    }
    return { block, index, score };
  });

  const hits = scored.filter((b) => b.score > 0).sort((x, y) => y.score - x.score);
  if (hits.length === 0) return `${text.slice(0, budget - OMISSION_MARK.length - 1)}\n${OMISSION_MARK}`;

  const chosen: typeof hits = [];
  let used = 0;
  for (const hit of hits) {
    const cost = hit.block.length + OMISSION_MARK.length + 2;
    if (used + cost > budget) continue;
    chosen.push(hit);
    used += cost;
  }
  if (chosen.length === 0) {
    return `${hits[0].block.slice(0, budget - OMISSION_MARK.length - 1)}\n${OMISSION_MARK}`;
  }

  chosen.sort((x, y) => x.index - y.index);
  const parts: string[] = [];
  let prevIndex = -1;
  for (const { block, index } of chosen) {
    if (index !== prevIndex + 1) parts.push(OMISSION_MARK);
    parts.push(block);
    prevIndex = index;
  }
  if (chosen[chosen.length - 1].index !== blocks.length - 1) parts.push(OMISSION_MARK);
  return parts.join("\n");
}

export async function recallMemories(
  db: SupabaseClient,
  userId: string,
  query: string,
  opts: {
    polyticianRerank?: boolean;
    branch?: { id: string; isDefault: boolean };
  } = {}
): Promise<RecalledMemory[]> {
  try {
    const { ranked } =
      opts.branch && !opts.branch.isDefault
        ? await branchRecallMemories(db, userId, opts.branch.id, query, MAX_RECALLED_MEMORIES)
        : await hybridRecallMemories(db, userId, query, MAX_RECALLED_MEMORIES, {
            polyticianRerank: opts.polyticianRerank,
          });
    let remaining = MEMORY_CONTEXT_BUDGET_CHARS;
    return ranked.map(({ memory }) => {
      const budget = Math.min(MAX_MEMORY_EXCERPT_CHARS, remaining);
      const excerpt =
        budget >= MIN_USEFUL_EXCERPT_CHARS ? excerptMemory(memory.content, query, budget) : "";
      remaining -= excerpt.length;
      return {
        title: memory.title,
        summary: memory.summary,
        content: memory.content,
        tags: memory.tags,
        excerpt,
      };
    });
  } catch {
    return [];
  }
}

export function recallContext(
  recalled: RecalledArtifact[],
  memories: RecalledMemory[] = []
): string {
  if (recalled.length === 0 && memories.length === 0) return "";
  const sections: string[] = [];

  if (memories.length > 0) {
    const blocks = memories.map((m) => {
      const header = `### Memory: "${m.title}"${m.tags?.length ? ` [${m.tags.join(", ")}]` : ""}`;
      const lines = [header];
      if (m.summary) lines.push(`Summary: ${m.summary.slice(0, MAX_SNIPPET_CHARS)}`);
      const body = m.excerpt || m.content.slice(0, MAX_SNIPPET_CHARS);
      if (body) {
        lines.push("Content (excerpted around the current message's topic; \"[…]\" marks omitted text):");
        lines.push('"""');
        lines.push(body);
        lines.push('"""');
      }
      return lines.join("\n");
    });
    sections.push(
      [
        "The user keeps a private memory wiki in HyperVault. The memories below were recalled as relevant to the current message, and their content is quoted directly from the vault — treat it as established context and answer from it.",
        "You have no separate search or fetch tool for the vault, but recall runs fresh on EVERY message (using the recent conversation for context), so this turn's excerpts are not the final word on what the vault holds. If the excerpts don't cover what the user asked, say what IS covered and invite a follow-up naming the topic, date, or message numbers they want (e.g. \"show messages 405-445\") — the next turn's excerpts will be pulled around that request. Never claim the vault lacks something just because it isn't quoted below, never claim you were given only metadata, and never invent memory content that isn't quoted here.",
        ...blocks,
      ].join("\n\n")
    );
  }

  if (recalled.length > 0) {
    const lines = recalled.map((a) => {
      const parts = [`- "${a.title}" (${appUrl()}/a/${a.slug})`];
      if (a.tags?.length) parts.push(`  tags: ${a.tags.join(", ")}`);
      if (a.source_prompt) {
        parts.push(`  source prompt: ${a.source_prompt.slice(0, MAX_SNIPPET_CHARS)}`);
      }
      return parts.join("\n");
    });
    sections.push(
      ["The user also has a HyperVault wiki of AI artifacts. These vault items look relevant — use them as shared memory and reference them by URL when helpful:", ...lines].join("\n")
    );
  }

  return sections.join("\n\n");
}
