import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/backends/crypto";
import {
  EMBEDDING_DIMENSIONS,
  embedTexts,
  pickEmbeddingBackend,
  probeEmbeddingBackend,
  type EmbeddingBackendRow,
} from "@/lib/backends/embeddings";

function withSecret<T>(fn: () => T): T {
  vi.stubEnv("HYPERVAULT_KEY_SECRET", "test-secret");
  try {
    return fn();
  } finally {
    vi.unstubAllEnvs();
  }
}

describe("pickEmbeddingBackend", () => {
  it("prefers a backend with an explicit embedding model over the OpenAI default", () => {
    withSecret(() => {
      const rows: EmbeddingBackendRow[] = [
        {
          provider: "openai",
          base_url: null,
          api_key_cipher: encryptSecret("sk-openai"),
          embedding_model: null,
        },
        {
          provider: "custom",
          base_url: "https://llm.example.com/v1",
          api_key_cipher: encryptSecret("ck-custom"),
          embedding_model: "my-embedder-1536",
        },
      ];
      const picked = pickEmbeddingBackend(rows)!;
      expect(picked.model).toBe("my-embedder-1536");
      expect(picked.baseUrl).toBe("https://llm.example.com/v1");
      expect(picked.apiKey).toBe("ck-custom");
    });
  });

  it("falls back to text-embedding-3-small on a plain OpenAI backend", () => {
    withSecret(() => {
      const picked = pickEmbeddingBackend([
        {
          provider: "openai",
          base_url: null,
          api_key_cipher: encryptSecret("sk-openai"),
          embedding_model: null,
        },
      ])!;
      expect(picked.model).toBe("text-embedding-3-small");
      expect(picked.baseUrl).toBe("https://api.openai.com/v1");
    });
  });

  it("allows keyless local/custom backends but never non-OpenAI protocols", () => {
    const rows: EmbeddingBackendRow[] = [
      { provider: "anthropic", base_url: null, api_key_cipher: null, embedding_model: "whatever" },
      { provider: "gemini", base_url: null, api_key_cipher: null, embedding_model: "whatever" },
      { provider: "ollama", base_url: null, api_key_cipher: null, embedding_model: "nomic-1536" },
    ];
    const picked = pickEmbeddingBackend(rows)!;
    expect(picked.model).toBe("nomic-1536");
    expect(picked.baseUrl).toBe("http://localhost:11434/v1");
    expect(picked.apiKey).toBeNull();
  });

  it("skips key-requiring providers without a key, and returns null when nothing qualifies", () => {
    expect(
      pickEmbeddingBackend([
        { provider: "openai", base_url: null, api_key_cipher: null, embedding_model: null },
        { provider: "custom", base_url: null, api_key_cipher: null, embedding_model: "m" },
        { provider: "anthropic", base_url: null, api_key_cipher: null, embedding_model: null },
      ])
    ).toBeNull();
  });
});

describe("embedTexts / probeEmbeddingBackend", () => {
  afterEach(() => vi.restoreAllMocks());

  function mockEmbeddings(dims: number, count = 1) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_url, init) => {
        const body = JSON.parse((init as RequestInit).body as string);
        const n = Array.isArray(body.input) ? body.input.length : count;
        return new Response(
          JSON.stringify({
            data: Array.from({ length: n }, (_, index) => ({
              index,
              embedding: Array.from({ length: dims }, () => 0.1),
            })),
          }),
          { status: 200 }
        );
      }
    );
  }

  it("sends the dimensions param only for the text-embedding-3 family", async () => {
    const spy = mockEmbeddings(EMBEDDING_DIMENSIONS);
    await embedTexts(
      { baseUrl: "https://api.openai.com/v1", apiKey: "sk", model: "text-embedding-3-small" },
      ["hello"]
    );
    let body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.dimensions).toBe(EMBEDDING_DIMENSIONS);

    await embedTexts(
      { baseUrl: "https://llm.example.com/v1", apiKey: null, model: "my-embedder" },
      ["hello"]
    );
    body = JSON.parse((spy.mock.calls[1][1] as RequestInit).body as string);
    expect(body.dimensions).toBeUndefined();
    const headers = (spy.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("rejects vectors of the wrong width", async () => {
    mockEmbeddings(768);
    const vectors = await embedTexts(
      { baseUrl: "https://llm.example.com/v1", apiKey: null, model: "small-embedder" },
      ["hello"]
    );
    expect(vectors).toBeNull();
  });

  it("probe passes on 1536 dims and names the actual width on mismatch", async () => {
    mockEmbeddings(EMBEDDING_DIMENSIONS);
    let probe = await probeEmbeddingBackend({
      baseUrl: "https://llm.example.com/v1",
      apiKey: null,
      model: "good-embedder",
    });
    expect(probe).toEqual({ ok: true });

    vi.restoreAllMocks();
    mockEmbeddings(768);
    probe = await probeEmbeddingBackend({
      baseUrl: "https://llm.example.com/v1",
      apiKey: null,
      model: "small-embedder",
    });
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.error).toContain("768-dim");
  });

  it("probe explains an endpoint that errors out", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 404 }) as never);
    const probe = await probeEmbeddingBackend({
      baseUrl: "https://llm.example.com/v1",
      apiKey: null,
      model: "missing-model",
    });
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.error).toContain("missing-model");
  });
});
