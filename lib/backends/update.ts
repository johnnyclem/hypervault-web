import { normalizeBaseUrl } from "@/lib/backends/chat";
import { providerSpec, type ProviderSpec } from "@/lib/backends/providers";


export type StoredBackend = {
  provider: string;
  name: string;
  base_url: string | null;
  default_model: string | null;
  embedding_model: string | null;
  api_key_cipher: string | null;
};

export type MergedBackendPatch = {
  ok: true;
  spec: ProviderSpec;
  name: string;
  baseUrl: string | null;
  defaultModel: string | null;
  embeddingModel: string | null;
  newApiKey: string | null;
  connectionChanged: boolean;
  embeddingChanged: boolean;
};

export type MergedBackendPatchError = { ok: false; error: string };

function patchField(
  body: Record<string, unknown>,
  key: string,
  stored: string | null,
  normalize: (raw: string) => string = (raw) => raw.trim()
): string | null {
  if (!(key in body)) return stored;
  const raw = body[key];
  if (raw === null) return null;
  if (typeof raw !== "string") return stored;
  const value = normalize(raw);
  return value || null;
}

export function mergeBackendPatch(
  stored: StoredBackend,
  body: Record<string, unknown>
): MergedBackendPatch | MergedBackendPatchError {
  const spec = providerSpec(stored.provider);
  if (!spec) return { ok: false, error: `Unknown provider: ${stored.provider}` };

  const name = patchField(body, "name", stored.name) ?? spec.label;
  const baseUrl = patchField(body, "base_url", stored.base_url, normalizeBaseUrl);
  const defaultModel = patchField(body, "default_model", stored.default_model);
  const embeddingModel = patchField(body, "embedding_model", stored.embedding_model);
  const newApiKey = (typeof body.api_key === "string" && body.api_key.trim()) || null;

  if (embeddingModel && spec.protocol !== "openai") {
    return {
      ok: false,
      error: `${spec.label} can't serve embeddings — only OpenAI-protocol backends expose /embeddings.`,
    };
  }
  if (spec.requiresKey && !newApiKey && !stored.api_key_cipher) {
    return { ok: false, error: `${spec.label} needs an API key.` };
  }
  if (stored.provider === "custom" && !baseUrl) {
    return { ok: false, error: "Custom endpoints need a base_url." };
  }
  if (stored.provider === "custom" && !defaultModel) {
    return { ok: false, error: "Custom endpoints need a default_model." };
  }

  const connectionChanged =
    newApiKey !== null || baseUrl !== stored.base_url || defaultModel !== stored.default_model;
  const embeddingChanged =
    embeddingModel !== null && (connectionChanged || embeddingModel !== stored.embedding_model);

  return {
    ok: true,
    spec,
    name,
    baseUrl,
    defaultModel,
    embeddingModel,
    newApiKey,
    connectionChanged,
    embeddingChanged,
  };
}
