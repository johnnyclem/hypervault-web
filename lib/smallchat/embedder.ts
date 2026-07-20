
import type { SupabaseClient } from "@supabase/supabase-js";
import { embedTextsAnyDim, getEmbeddingBackend, type EmbeddingBackend } from "@/lib/backends/embeddings";
import { MINILM_MODEL, OnnxEmbedder } from "@/lib/smallchat/onnx-embedder";
import type { Embedder } from "@/lib/vendor/smallchat/core/types";
import { LocalEmbedder } from "@/lib/vendor/smallchat/embedding/local-embedder";

const HASH_MODEL = "hash";

export type EmbedderIdentity =
  | { kind: "api"; model: string; dimensions: number }
  | { kind: "local"; dimensions: number; model?: string };

const EMBED_BATCH = 24;
const EMBED_TIMEOUT_MS = 30_000;

export class ApiEmbedder implements Embedder {
  constructor(
    private readonly backend: EmbeddingBackend,
    readonly dimensions: number
  ) {}

  async embed(text: string): Promise<Float32Array> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const slice = texts.slice(i, i + EMBED_BATCH);
      const vectors = await embedTextsAnyDim(this.backend, slice, EMBED_TIMEOUT_MS);
      if (!vectors || vectors.length !== slice.length) {
        throw new Error(`The embedding backend (${this.backend.model}) did not return vectors.`);
      }
      for (const v of vectors) {
        if (v.length !== this.dimensions) {
          throw new Error(
            `The embedding backend returned ${v.length}-dim vectors but ${this.dimensions} were expected.`
          );
        }
        out.push(new Float32Array(v));
      }
    }
    return out;
  }
}

export type ResolvedEmbedder = { embedder: Embedder; identity: EmbedderIdentity };

export type OnnxDiagnostics = {
  attempted: boolean;
  backend: "node" | "web" | null;
  error: string | null;
};

let onnxDiag: OnnxDiagnostics = { attempted: false, backend: null, error: null };

export function onnxDiagnostics(): OnnxDiagnostics {
  return { ...onnxDiag };
}

let onnxEmbedderPromise: Promise<OnnxEmbedder | null> | null = null;

function getOnnxEmbedder(): Promise<OnnxEmbedder | null> {
  if (!onnxEmbedderPromise) {
    onnxEmbedderPromise = (async () => {
      onnxDiag = { attempted: true, backend: null, error: null };
      try {
        const embedder = new OnnxEmbedder();
        await embedder.whenReady();
        onnxDiag = { attempted: true, backend: embedder.backend, error: null };
        return embedder;
      } catch (err) {
        onnxDiag = {
          attempted: true,
          backend: null,
          error: err instanceof Error ? err.message : String(err),
        };
        return null;
      }
    })();
  }
  return onnxEmbedderPromise;
}

export async function resolveEmbedder(admin: SupabaseClient, userId: string): Promise<ResolvedEmbedder> {
  try {
    const backend = await getEmbeddingBackend(admin, userId);
    if (backend) {
      const probe = await embedTextsAnyDim(backend, ["smallchat embedder probe"], EMBED_TIMEOUT_MS);
      const dims = probe?.[0]?.length ?? 0;
      if (dims > 0) {
        return {
          embedder: new ApiEmbedder(backend, dims),
          identity: { kind: "api", model: backend.model, dimensions: dims },
        };
      }
    }
  } catch {
  }

  const onnx = process.env.SMALLCHAT_DISABLE_LOCAL_ONNX === "1" ? null : await getOnnxEmbedder();
  if (onnx) {
    return {
      embedder: onnx,
      identity: { kind: "local", dimensions: onnx.dimensions, model: MINILM_MODEL },
    };
  }

  const local = new LocalEmbedder();
  return { embedder: local, identity: { kind: "local", dimensions: local.dimensions, model: HASH_MODEL } };
}

function localModel(identity: Extract<EmbedderIdentity, { kind: "local" }>): string {
  return identity.model ?? HASH_MODEL;
}

export function embedderMatches(a: EmbedderIdentity, b: EmbedderIdentity): boolean {
  if (a.kind !== b.kind || a.dimensions !== b.dimensions) return false;
  if (a.kind === "api" && b.kind === "api") return a.model === b.model;
  if (a.kind === "local" && b.kind === "local") return localModel(a) === localModel(b);
  return true;
}

export function describeEmbedder(identity: EmbedderIdentity): string {
  if (identity.kind === "api") return `semantic (${identity.model}, ${identity.dimensions}d)`;
  return localModel(identity) === MINILM_MODEL
    ? `semantic (MiniLM-L6-v2, ${identity.dimensions}d local)`
    : `lexical fallback (${identity.dimensions}d hash)`;
}

export function isLexicalEmbedder(identity: EmbedderIdentity): boolean {
  return identity.kind === "local" && localModel(identity) === HASH_MODEL;
}

export function embedderStrength(identity: EmbedderIdentity): number {
  if (identity.kind === "api") return 2;
  return localModel(identity) === MINILM_MODEL ? 1 : 0;
}

export function isEmbedderUpgrade(stored: EmbedderIdentity, available: EmbedderIdentity): boolean {
  return embedderStrength(available) > embedderStrength(stored);
}
