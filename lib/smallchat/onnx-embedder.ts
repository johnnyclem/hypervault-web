
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Embedder } from "@/lib/vendor/smallchat/core/types";

export const MINILM_MODEL = "minilm-l6-v2";
export const MINILM_DIMENSIONS = 384;

const EXPECTED_MODEL_SHA256 = "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1";

type OrtLike = {
  InferenceSession: {
    create(data: Uint8Array, options?: unknown): Promise<OrtSession>;
  };
  Tensor: new (type: string, data: BigInt64Array, dims: number[]) => OrtTensor;
  env?: { wasm?: { numThreads?: number; wasmPaths?: string; proxy?: boolean } };
};
type OrtTensor = { data: unknown; dims: readonly number[] };
type OrtSession = { run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>> };

export type OnnxEmbedderOptions = {
  modelsDir?: string;
  maxLength?: number;
  cacheSize?: number;
};

export type OnnxBackend = "node" | "web";

export function defaultModelsDir(): string {
  return path.join(process.cwd(), "lib", "smallchat", "models");
}

export class OnnxEmbedder implements Embedder {
  readonly dimensions = MINILM_DIMENSIONS;

  private readonly modelsDir: string;
  private readonly maxLength: number;
  private readonly cacheMaxSize: number;
  private readonly cache = new Map<string, Float32Array>();

  private session: OrtSession | null = null;
  private ort: OrtLike | null = null;
  private tokenizer: WordPieceTokenizer | null = null;
  private readonly ready: Promise<void>;
  backend: OnnxBackend | null = null;

  constructor(options?: OnnxEmbedderOptions) {
    this.modelsDir = options?.modelsDir ?? defaultModelsDir();
    this.maxLength = options?.maxLength ?? 128;
    this.cacheMaxSize = options?.cacheSize ?? 2048;
    this.ready = this.initialize();
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  private async initialize(): Promise<void> {
    const modelPath = path.join(this.modelsDir, "model_quantized.onnx");
    const tokenizerPath = path.join(this.modelsDir, "tokenizer.json");

    const modelBytes = readFileSync(modelPath);
    const hash = createHash("sha256").update(modelBytes).digest("hex");
    if (hash !== EXPECTED_MODEL_SHA256) {
      throw new Error(
        `MiniLM model integrity check failed at ${modelPath} (got ${hash.slice(0, 12)}…).`
      );
    }

    const tokenizerData = JSON.parse(readFileSync(tokenizerPath, "utf-8")) as TokenizerConfig;
    this.tokenizer = new WordPieceTokenizer(tokenizerData, this.maxLength);

    const { ort, backend } = await loadOrt();
    this.ort = ort;
    this.backend = backend;
    this.session = await ort.InferenceSession.create(new Uint8Array(modelBytes), {
      executionProviders: [backend === "node" ? "cpu" : "wasm"],
    });

    await this.embedInternal("warmup");
  }

  async embed(text: string): Promise<Float32Array> {
    await this.ready;
    const cached = this.cache.get(text);
    if (cached) return cached;
    const [vec] = await this.embedBatchInternal([text]);
    this.store(text, vec);
    return vec;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    await this.ready;
    const results: (Float32Array | null)[] = texts.map((t) => this.cache.get(t) ?? null);
    const missing = results.map((r, i) => (r === null ? i : -1)).filter((i) => i >= 0);
    if (missing.length === 0) return results as Float32Array[];

    const embedded = await this.embedBatchInternal(missing.map((i) => texts[i]));
    missing.forEach((idx, j) => {
      results[idx] = embedded[j];
      this.store(texts[idx], embedded[j]);
    });
    return results as Float32Array[];
  }

  private store(text: string, vec: Float32Array): void {
    if (this.cache.size >= this.cacheMaxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(text, vec);
  }

  private async embedInternal(text: string): Promise<Float32Array> {
    const [vec] = await this.embedBatchInternal([text]);
    return vec;
  }

  private async embedBatchInternal(texts: string[]): Promise<Float32Array[]> {
    const ort = this.ort!;
    const session = this.session!;
    const tokenizer = this.tokenizer!;
    const seqLen = this.maxLength;
    const batch = texts.length;

    const inputIds = new BigInt64Array(batch * seqLen);
    const attentionMask = new BigInt64Array(batch * seqLen);
    const tokenTypeIds = new BigInt64Array(batch * seqLen);
    const encoded = texts.map((t) => tokenizer.encode(t));

    for (let b = 0; b < batch; b++) {
      const ids = encoded[b].inputIds;
      const offset = b * seqLen;
      for (let i = 0; i < ids.length; i++) {
        inputIds[offset + i] = BigInt(ids[i]);
        attentionMask[offset + i] = 1n;
      }
    }

    const feeds: Record<string, OrtTensor> = {
      input_ids: new ort.Tensor("int64", inputIds, [batch, seqLen]),
      attention_mask: new ort.Tensor("int64", attentionMask, [batch, seqLen]),
      token_type_ids: new ort.Tensor("int64", tokenTypeIds, [batch, seqLen]),
    };

    const output = await session.run(feeds);
    const hidden = output["last_hidden_state"];
    const data = hidden.data as Float32Array;
    const dim = this.dimensions;

    const results: Float32Array[] = [];
    for (let b = 0; b < batch; b++) {
      const vec = new Float32Array(dim);
      const mask = encoded[b].attentionMask;
      let count = 0;
      for (let t = 0; t < seqLen; t++) {
        if (mask[t] !== 1) continue;
        count++;
        const base = (b * seqLen + t) * dim;
        for (let d = 0; d < dim; d++) vec[d] += data[base + d];
      }
      if (count > 0) for (let d = 0; d < dim; d++) vec[d] /= count;
      let norm = 0;
      for (let d = 0; d < dim; d++) norm += vec[d] * vec[d];
      norm = Math.sqrt(norm);
      if (norm > 0) for (let d = 0; d < dim; d++) vec[d] /= norm;
      results.push(vec);
    }
    return results;
  }
}


async function loadOrt(): Promise<{ ort: OrtLike; backend: OnnxBackend }> {
  try {
    // @ts-ignore optional native dependency — types may be absent, resolved at runtime
    const nodeMod = (await import(/* webpackIgnore: true */ "onnxruntime-node")) as unknown as OrtLike;
    if (nodeMod?.InferenceSession) return { ort: nodeMod, backend: "node" };
  } catch {
  }

  const webMod = (await import("onnxruntime-web")) as unknown as OrtLike;
  if (webMod?.env?.wasm) {
    webMod.env.wasm.numThreads = 1;
    webMod.env.wasm.proxy = false;
    const override = process.env.ONNX_WASM_PATH;
    webMod.env.wasm.wasmPaths =
      override && override.length > 0
        ? override
        : path.join(process.cwd(), "node_modules", "onnxruntime-web", "dist") + path.sep;
  }
  return { ort: webMod, backend: "web" };
}


interface TokenizerConfig {
  model: {
    vocab: Record<string, number>;
    unk_token: string;
    continuing_subword_prefix?: string;
    max_input_chars_per_word?: number;
  };
  normalizer?: { lowercase?: boolean };
}

class WordPieceTokenizer {
  private readonly vocab: Map<string, number>;
  private readonly unk: number;
  private readonly cls: number;
  private readonly sep: number;
  private readonly prefix: string;
  private readonly maxCharsPerWord: number;
  private readonly maxLength: number;
  private readonly lowercase: boolean;

  constructor(config: TokenizerConfig, maxLength: number) {
    this.vocab = new Map(Object.entries(config.model.vocab));
    this.unk = this.vocab.get(config.model.unk_token) ?? 100;
    this.cls = this.vocab.get("[CLS]") ?? 101;
    this.sep = this.vocab.get("[SEP]") ?? 102;
    this.prefix = config.model.continuing_subword_prefix ?? "##";
    this.maxCharsPerWord = config.model.max_input_chars_per_word ?? 100;
    this.maxLength = maxLength;
    this.lowercase = config.normalizer?.lowercase ?? true;
  }

  encode(text: string): { inputIds: number[]; attentionMask: number[] } {
    let s = this.lowercase ? text.toLowerCase() : text;
    s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ");
    s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");

    const ids: number[] = [this.cls];
    for (const word of this.preTokenize(s)) {
      if (ids.length >= this.maxLength - 1) break;
      for (const id of this.wordPiece(word)) {
        if (ids.length >= this.maxLength - 1) break;
        ids.push(id);
      }
    }
    ids.push(this.sep);
    return { inputIds: ids, attentionMask: new Array(ids.length).fill(1) };
  }

  private preTokenize(text: string): string[] {
    const tokens: string[] = [];
    let cur = "";
    for (const ch of text) {
      if (this.isWhitespace(ch)) {
        if (cur) { tokens.push(cur); cur = ""; }
      } else if (this.isPunct(ch) || this.isCjk(ch)) {
        if (cur) { tokens.push(cur); cur = ""; }
        tokens.push(ch);
      } else {
        cur += ch;
      }
    }
    if (cur) tokens.push(cur);
    return tokens;
  }

  private wordPiece(word: string): number[] {
    if (word.length > this.maxCharsPerWord) return [this.unk];
    const out: number[] = [];
    let start = 0;
    while (start < word.length) {
      let end = word.length;
      let found: number | null = null;
      while (start < end) {
        const piece = start === 0 ? word.slice(start, end) : this.prefix + word.slice(start, end);
        const id = this.vocab.get(piece);
        if (id !== undefined) { found = id; break; }
        end--;
      }
      if (found === null) return [this.unk];
      out.push(found);
      start = end;
    }
    return out;
  }

  private isWhitespace(ch: string): boolean {
    return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch.charCodeAt(0) === 0x00a0;
  }

  private isPunct(ch: string): boolean {
    const c = ch.charCodeAt(0);
    return (
      (c >= 33 && c <= 47) || (c >= 58 && c <= 64) ||
      (c >= 91 && c <= 96) || (c >= 123 && c <= 126) ||
      (c >= 0x2000 && c <= 0x206f)
    );
  }

  private isCjk(ch: string): boolean {
    const c = ch.codePointAt(0) ?? 0;
    return (
      (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0x20000 && c <= 0x2a6df) || (c >= 0xf900 && c <= 0xfaff)
    );
  }
}
