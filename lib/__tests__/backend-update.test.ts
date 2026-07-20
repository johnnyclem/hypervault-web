import { describe, expect, it } from "vitest";
import { mergeBackendPatch, type StoredBackend } from "@/lib/backends/update";

const stored: StoredBackend = {
  provider: "custom",
  name: "My endpoint",
  base_url: "https://llm.example.com/v1",
  default_model: "my-model",
  embedding_model: null,
  api_key_cipher: "iv.ct.tag",
};

describe("mergeBackendPatch", () => {
  it("keeps stored values for omitted fields and reports no connection change", () => {
    const merged = mergeBackendPatch(stored, {});
    expect(merged).toMatchObject({
      ok: true,
      name: "My endpoint",
      baseUrl: "https://llm.example.com/v1",
      defaultModel: "my-model",
      embeddingModel: null,
      newApiKey: null,
      connectionChanged: false,
      embeddingChanged: false,
    });
  });

  it("treats a name-only edit as no connection change", () => {
    const merged = mergeBackendPatch(stored, { name: "  Renamed  " });
    expect(merged).toMatchObject({ ok: true, name: "Renamed", connectionChanged: false });
  });

  it("flags the connection as changed when the model, base URL, or key changes", () => {
    expect(mergeBackendPatch(stored, { default_model: "other-model" })).toMatchObject({
      ok: true,
      defaultModel: "other-model",
      connectionChanged: true,
    });
    expect(mergeBackendPatch(stored, { base_url: "https://new.example.com/v1/" })).toMatchObject({
      ok: true,
      baseUrl: "https://new.example.com/v1",
      connectionChanged: true,
    });
    expect(mergeBackendPatch(stored, { api_key: "ck-new" })).toMatchObject({
      ok: true,
      newApiKey: "ck-new",
      connectionChanged: true,
    });
  });

  it("keeps the stored key when api_key is blank", () => {
    const merged = mergeBackendPatch(stored, { api_key: "   " });
    expect(merged).toMatchObject({ ok: true, newApiKey: null, connectionChanged: false });
  });

  it("clears optional fields with an empty string and re-verifies embeddings when set", () => {
    const withEmbeddings = { ...stored, embedding_model: "embed-v1" };
    expect(mergeBackendPatch(withEmbeddings, { embedding_model: "" })).toMatchObject({
      ok: true,
      embeddingModel: null,
      embeddingChanged: false,
    });
    expect(mergeBackendPatch(stored, { embedding_model: "embed-v1" })).toMatchObject({
      ok: true,
      embeddingModel: "embed-v1",
      embeddingChanged: true,
    });
    expect(mergeBackendPatch(withEmbeddings, { api_key: "ck-new" })).toMatchObject({
      ok: true,
      embeddingChanged: true,
    });
    expect(mergeBackendPatch(withEmbeddings, { name: "Renamed" })).toMatchObject({
      ok: true,
      embeddingChanged: false,
    });
  });

  it("rejects edits that would break the backend", () => {
    expect(mergeBackendPatch(stored, { base_url: "" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("base_url"),
    });
    expect(mergeBackendPatch(stored, { default_model: null })).toMatchObject({
      ok: false,
      error: expect.stringContaining("default_model"),
    });
    const anthropic: StoredBackend = {
      provider: "anthropic",
      name: "Claude",
      base_url: null,
      default_model: null,
      embedding_model: null,
      api_key_cipher: "iv.ct.tag",
    };
    expect(mergeBackendPatch(anthropic, { embedding_model: "embed-v1" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("embeddings"),
    });
    expect(mergeBackendPatch({ ...anthropic, api_key_cipher: null }, {})).toMatchObject({
      ok: false,
      error: expect.stringContaining("API key"),
    });
  });

  it("falls back to the provider label when the name is cleared", () => {
    const merged = mergeBackendPatch(stored, { name: "" });
    expect(merged).toMatchObject({ ok: true, name: "Custom endpoint (OpenAI-compatible)" });
  });
});
