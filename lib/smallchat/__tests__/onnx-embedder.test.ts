import path from "node:path";
import { describe, expect, it } from "vitest";
import { OnnxEmbedder } from "@/lib/smallchat/onnx-embedder";
import {
  describeEmbedder,
  embedderMatches,
  embedderStrength,
  isEmbedderUpgrade,
  isLexicalEmbedder,
  type EmbedderIdentity,
} from "@/lib/smallchat/embedder";

const MODELS_DIR = path.join(process.cwd(), "lib", "smallchat", "models");
const cos = (a: Float32Array, b: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

describe("OnnxEmbedder (MiniLM via WASM)", () => {
  it("produces 384-dim vectors that order tools semantically", async () => {
    const embedder = new OnnxEmbedder({ modelsDir: MODELS_DIR });
    await embedder.whenReady();

    const [query, listTasks, listReminders, deleteFile] = await embedder.embedBatch([
      "list all tasks",
      "list_tasks: list all tasks in the vault",
      "list_reminders: list reminders",
      "delete_file: permanently remove a file from disk",
    ]);

    expect(query.length).toBe(384);

    const toTasks = cos(query, listTasks);
    const toReminders = cos(query, listReminders);
    const toDelete = cos(query, deleteFile);

    expect(toTasks).toBeGreaterThan(0.6);
    expect(toTasks).toBeGreaterThan(toReminders);
    expect(toTasks).toBeGreaterThan(toDelete);
    expect(toDelete).toBeLessThan(0.4);
  }, 30_000);

  it("is deterministic and caches repeated intents", async () => {
    const embedder = new OnnxEmbedder({ modelsDir: MODELS_DIR });
    const a = await embedder.embed("create a new page");
    const b = await embedder.embed("create a new page");
    expect(Array.from(a)).toEqual(Array.from(b));
  }, 30_000);
});

describe("embedder identity (local model discriminator)", () => {
  const hashUntagged: EmbedderIdentity = { kind: "local", dimensions: 384 };
  const hash: EmbedderIdentity = { kind: "local", dimensions: 384, model: "hash" };
  const minilm: EmbedderIdentity = { kind: "local", dimensions: 384, model: "minilm-l6-v2" };

  it("treats an untagged local identity as the hash embedder", () => {
    expect(embedderMatches(hashUntagged, hash)).toBe(true);
  });

  it("refuses to match hash and MiniLM even though both are 384-dim local", () => {
    expect(embedderMatches(hash, minilm)).toBe(false);
    expect(embedderMatches(hashUntagged, minilm)).toBe(false);
  });

  it("describes MiniLM as semantic and hash as a lexical fallback", () => {
    expect(describeEmbedder(minilm)).toContain("MiniLM");
    expect(describeEmbedder(hash)).toContain("lexical");
  });
});

describe("embedder strength & upgrade detection", () => {
  const hash: EmbedderIdentity = { kind: "local", dimensions: 384, model: "hash" };
  const untagged: EmbedderIdentity = { kind: "local", dimensions: 384 };
  const minilm: EmbedderIdentity = { kind: "local", dimensions: 384, model: "minilm-l6-v2" };
  const api: EmbedderIdentity = { kind: "api", model: "text-embedding-3-small", dimensions: 1536 };

  it("flags only the hash embedder as lexical", () => {
    expect(isLexicalEmbedder(hash)).toBe(true);
    expect(isLexicalEmbedder(untagged)).toBe(true);
    expect(isLexicalEmbedder(minilm)).toBe(false);
    expect(isLexicalEmbedder(api)).toBe(false);
  });

  it("orders hash < MiniLM < API", () => {
    expect(embedderStrength(hash)).toBeLessThan(embedderStrength(minilm));
    expect(embedderStrength(minilm)).toBeLessThan(embedderStrength(api));
  });

  it("calls a recompile an upgrade only when the available embedder is stronger", () => {
    expect(isEmbedderUpgrade(hash, minilm)).toBe(true);
    expect(isEmbedderUpgrade(untagged, minilm)).toBe(true);
    expect(isEmbedderUpgrade(hash, api)).toBe(true);
    expect(isEmbedderUpgrade(minilm, minilm)).toBe(false);
    expect(isEmbedderUpgrade(api, minilm)).toBe(false);
    expect(isEmbedderUpgrade(minilm, hash)).toBe(false);
  });
});
