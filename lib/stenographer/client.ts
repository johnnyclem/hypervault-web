
const STENOGRAPHER_TIMEOUT_MS = 1_500;
const GRAPHRAG_K = 5;
const GRAPHRAG_DEPTH = 2;
const MAX_CHUNK_CHARS = 700;

type RetrievedChunk = {
  id: string;
  content: string;
  score: number;
  type: "message" | "entity" | "decision" | "path";
  meta?: unknown;
};

export function stenographerUrl(): string | null {
  const url = process.env.STENOGRAPHER_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

export function isStenographerConfigured(): boolean {
  return stenographerUrl() !== null;
}

const TYPE_LABEL: Record<RetrievedChunk["type"], string> = {
  decision: "decision",
  entity: "entity",
  path: "connection",
  message: "past message",
};

export type StenographerRecall = {
  contextBlock: string;
  labels: string[];
};

export async function stenographerRecall(query: string): Promise<StenographerRecall | null> {
  const base = stenographerUrl();
  if (!base || !query.trim()) return null;

  try {
    const res = await fetch(
      `${base}/graphrag?q=${encodeURIComponent(query)}&k=${GRAPHRAG_K}&depth=${GRAPHRAG_DEPTH}`,
      { signal: AbortSignal.timeout(STENOGRAPHER_TIMEOUT_MS) }
    );
    if (!res.ok) return null;
    const chunks = (await res.json()) as RetrievedChunk[];
    if (!Array.isArray(chunks) || chunks.length === 0) return null;

    const lines: string[] = [];
    const labels: string[] = [];
    for (const chunk of chunks) {
      const content = typeof chunk.content === "string" ? chunk.content.trim() : "";
      if (!content) continue;
      const label = TYPE_LABEL[chunk.type] ?? "context";
      lines.push(`- [${label}] ${content.slice(0, MAX_CHUNK_CHARS)}`);
      labels.push(`${label}: ${content.split("\n")[0].slice(0, 60)}`);
    }
    if (lines.length === 0) return null;

    const contextBlock = [
      "## Long-horizon memory (conversation graph)",
      "The user's past conversations are indexed as a knowledge graph (entities, decisions, and messages across every chat, not just this one). The entries below were retrieved as relevant to the current message — treat them as established context. Decisions may have been superseded later; prefer the most recent when they conflict.",
      lines.join("\n"),
    ].join("\n\n");

    return { contextBlock, labels };
  } catch {
    return null;
  }
}
