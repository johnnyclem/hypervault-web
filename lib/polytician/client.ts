
const POLYTICIAN_TIMEOUT_MS = 1_500;
const MAX_EMBED_TEXTS = 100;

export function polyticianSidecarUrl(): string | null {
  const url = process.env.POLYTICIAN_SIDECAR_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

export function isPolyticianConfigured(): boolean {
  return polyticianSidecarUrl() !== null;
}

export async function polyticianEmbed(texts: string[]): Promise<number[][] | null> {
  const base = polyticianSidecarUrl();
  if (!base || texts.length === 0) return null;
  try {
    const res = await fetch(`${base}/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texts: texts.slice(0, MAX_EMBED_TEXTS) }),
      signal: AbortSignal.timeout(POLYTICIAN_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { embeddings?: number[][] } | number[][];
    const embeddings = Array.isArray(json) ? json : json.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== texts.slice(0, MAX_EMBED_TEXTS).length) return null;
    return embeddings;
  } catch {
    return null;
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function polyticianRerank(
  query: string,
  candidates: { id: string; text: string }[]
): Promise<Map<string, number> | null> {
  if (!isPolyticianConfigured() || !query.trim() || candidates.length === 0) return null;
  const capped = candidates.slice(0, MAX_EMBED_TEXTS - 1);
  const vectors = await polyticianEmbed([query, ...capped.map((c) => c.text)]);
  if (!vectors) return null;

  const [queryVec, ...candVecs] = vectors;
  const scored = capped
    .map((c, i) => ({ id: c.id, score: cosine(queryVec, candVecs[i]) }))
    .sort((x, y) => y.score - x.score);

  const rank = new Map<string, number>();
  scored.forEach((s, i) => rank.set(s.id, i));
  return rank;
}
