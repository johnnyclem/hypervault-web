import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/backends/crypto";
import { providerSpec } from "@/lib/backends/providers";
import { isMissingEmbeddingColumn } from "@/lib/backends/schema-compat";


export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
const EMBED_TIMEOUT_MS = 1500;
const BACKFILL_TIMEOUT_MS = 8000;
const PROBE_TIMEOUT_MS = 6000;
const BACKFILL_BATCH = 24;

export type EmbeddingBackend = {
  baseUrl: string;
  apiKey: string | null;
  model: string;
};

export type EmbeddingBackendRow = {
  provider: string;
  base_url: string | null;
  api_key_cipher: string | null;
  embedding_model: string | null;
  created_at?: string;
};

export function pickEmbeddingBackend(rows: EmbeddingBackendRow[]): EmbeddingBackend | null {
  let fallback: EmbeddingBackend | null = null;
  for (const row of rows) {
    const spec = providerSpec(row.provider);
    if (!spec || spec.protocol !== "openai") continue;

    const baseUrl = (row.base_url || spec.defaultBaseUrl).replace(/\/$/, "");
    if (!baseUrl) continue;

    const apiKey = row.api_key_cipher ? decryptSecret(row.api_key_cipher) : null;
    if (row.api_key_cipher && !apiKey) continue;
    if (spec.requiresKey && !apiKey) continue;

    const model = row.embedding_model?.trim() || "";
    if (model) return { baseUrl, apiKey, model };
    if (!fallback && spec.defaultEmbeddingModel) {
      fallback = { baseUrl, apiKey, model: spec.defaultEmbeddingModel };
    }
  }
  return fallback;
}

export async function getEmbeddingBackend(db: SupabaseClient, userId: string): Promise<EmbeddingBackend | null> {
  const { data, error } = await db
    .from("llm_backends")
    .select("provider, base_url, api_key_cipher, embedding_model")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(20);
  let rows: EmbeddingBackendRow[] = (data ?? []) as EmbeddingBackendRow[];
  if (error && isMissingEmbeddingColumn(error)) {
    const retry = await db
      .from("llm_backends")
      .select("provider, base_url, api_key_cipher")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(20);
    rows = (retry.data ?? []).map((row) => ({ ...row, embedding_model: null }));
  }
  return pickEmbeddingBackend(rows);
}

function supportsDimensionsParam(model: string): boolean {
  return model.startsWith("text-embedding-3");
}

async function callEmbeddings(
  backend: EmbeddingBackend,
  texts: string[],
  timeoutMs: number
): Promise<number[][] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (backend.apiKey) headers.Authorization = `Bearer ${backend.apiKey}`;
    const res = await fetch(`${backend.baseUrl}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: backend.model,
        input: texts.map((t) => t.slice(0, 8000)),
        ...(supportsDimensionsParam(backend.model) ? { dimensions: EMBEDDING_DIMENSIONS } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
    if (!payload.data || payload.data.length !== texts.length) return null;
    return [...payload.data].sort((x, y) => x.index - y.index).map((d) => d.embedding);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function embedTexts(
  backend: EmbeddingBackend,
  texts: string[],
  timeoutMs = EMBED_TIMEOUT_MS
): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  const vectors = await callEmbeddings(backend, texts, timeoutMs);
  if (!vectors) return null;
  if (vectors.some((v) => !Array.isArray(v) || v.length !== EMBEDDING_DIMENSIONS)) return null;
  return vectors;
}

export async function embedTextsAnyDim(
  backend: EmbeddingBackend,
  texts: string[],
  timeoutMs = BACKFILL_TIMEOUT_MS
): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  return callEmbeddings(backend, texts, timeoutMs);
}

export type EmbeddingProbe =
  | { ok: true }
  | { ok: false; error: string };

export async function probeEmbeddingBackend(backend: EmbeddingBackend): Promise<EmbeddingProbe> {
  const vectors = await callEmbeddings(backend, ["hypervault embedding probe"], PROBE_TIMEOUT_MS);
  if (!vectors || !Array.isArray(vectors[0])) {
    return {
      ok: false,
      error: `The endpoint did not return an embedding for model "${backend.model}" — check the model name, base URL, and key.`,
    };
  }
  const dims = vectors[0].length;
  if (dims !== EMBEDDING_DIMENSIONS) {
    return {
      ok: false,
      error: `Model "${backend.model}" returns ${dims}-dim vectors, but semantic recall needs ${EMBEDDING_DIMENSIONS} dims. Pick a ${EMBEDDING_DIMENSIONS}-dim model (e.g. ${EMBEDDING_MODEL}).`,
    };
  }
  return { ok: true };
}

export async function embedMemoryBestEffort(
  db: SupabaseClient,
  userId: string,
  memoryId: string,
  text: string
): Promise<void> {
  try {
    const backend = await getEmbeddingBackend(db, userId);
    if (!backend) return;
    const vectors = await embedTexts(backend, [text]);
    if (!vectors || !vectors[0]) return;
    await db
      .from("memories")
      .update({ embedding: JSON.stringify(vectors[0]), embedding_model: backend.model })
      .eq("id", memoryId)
      .eq("user_id", userId);
  } catch {
  }
}

export async function backfillEmbeddingsBestEffort(
  db: SupabaseClient,
  userId: string,
  backend: EmbeddingBackend,
  max = BACKFILL_BATCH
): Promise<number> {
  try {
    const { data } = await db
      .from("memories")
      .select("id, title, content")
      .eq("user_id", userId)
      .is("embedding", null)
      .order("created_at", { ascending: false })
      .limit(max);
    if (!data || data.length === 0) return 0;

    const vectors = await embedTexts(
      backend,
      data.map((m) => `${m.title}\n${m.content}`),
      BACKFILL_TIMEOUT_MS
    );
    if (!vectors) return 0;

    let stamped = 0;
    await Promise.all(
      data.map(async (m, i) => {
        const v = vectors[i];
        if (!v) return;
        const { error } = await db
          .from("memories")
          .update({ embedding: JSON.stringify(v), embedding_model: backend.model })
          .eq("id", m.id)
          .eq("user_id", userId);
        if (!error) stamped++;
      })
    );
    return stamped;
  } catch {
    return 0;
  }
}

export async function embedQueryBestEffort(
  db: SupabaseClient,
  userId: string,
  query: string
): Promise<{ vector: number[]; model: string } | null> {
  try {
    const backend = await getEmbeddingBackend(db, userId);
    if (!backend) return null;
    const vectors = await embedTexts(backend, [query]);
    if (!vectors || !vectors[0]) return null;
    return { vector: vectors[0], model: backend.model };
  } catch {
    return null;
  }
}
