import type { CanonicalMessage } from "@/lib/chat/canonical";
import { stripThinking } from "@/lib/chat/thinking";
import { providerSpec, type WireProtocol } from "@/lib/backends/providers";


export type BackendConfig = {
  provider: string;
  baseUrl?: string | null;
  model?: string | null;
  apiKey?: string | null;
};

export type ChatReply = {
  text: string;
  model: string;
  truncated: boolean;
};

const MAX_TOKENS = 16_384;
const MIN_MAX_TOKENS = 1_024;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_CONTINUATIONS = 3;
const CONTINUE_PROMPT =
  "Your previous message was cut off mid-output by a length limit. " +
  "Continue exactly where it stopped — output only the continuation, " +
  "with no repetition of earlier content and no preamble.";

export type SendOptions = {
  maxTokens?: number;
  timeoutMs?: number;
  maxContinuations?: number;
};

export class BackendHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BackendHttpError";
    this.status = status;
  }
}

export function normalizeBaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/, "")
    .replace(/\/v1\/messages$/, "")
    .replace(/\/+$/, "");
}

export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host === "[::1]" ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.endsWith(".local") ||
      host.endsWith(".localhost") ||
      host.endsWith(".internal")
    );
  } catch {
    return false;
  }
}

function describeUnreachable(url: string, err: unknown): string {
  if (err instanceof Error && err.name === "TimeoutError") {
    return `No response from ${url} — the endpoint may be offline, overloaded, or unreachable from this server.`;
  }
  if (isLocalUrl(url)) {
    return (
      `Could not reach ${url} from the HyperVault server. A localhost/LAN address points at the machine ` +
      `running HyperVault — not your device — so local backends (Ollama, LM Studio) only work when HyperVault ` +
      `runs on the same machine. On the hosted app, expose your local backend with a tunnel ` +
      `(e.g. \`ngrok http 11434\` or Tailscale Funnel) and use that public URL as the Base URL, ` +
      `or use a cloud endpoint like https://ollama.com/v1.`
    );
  }
  return `Could not reach ${url} — check the Base URL and that the endpoint is online.`;
}

type WireMessage = { role: "system" | "user" | "assistant"; content: string };

export function toWireMessages(messages: CanonicalMessage[]): WireMessage[] {
  const wire: WireMessage[] = [];
  for (const m of messages) {
    let content = m.content;
    const extracted = m.attachments
      .filter((a) => a.extracted_text)
      .map((a) => `[Attachment: ${a.name}]\n${a.extracted_text}`)
      .join("\n\n");
    if (extracted) content = content ? `${content}\n\n${extracted}` : extracted;
    if (!content.trim()) continue;

    const role = m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user";
    const prev = wire[wire.length - 1];
    if (prev && prev.role === role) prev.content += `\n\n${content}`;
    else wire.push({ role, content });
  }
  const firstChat = wire.findIndex((m) => m.role !== "system");
  if (firstChat !== -1 && wire[firstChat].role === "assistant") {
    wire.splice(firstChat, 0, { role: "user", content: "(continuing an imported conversation)" });
  }
  return wire;
}

export function resolveBackend(config: BackendConfig): {
  protocol: WireProtocol;
  baseUrl: string;
  model: string;
} | null {
  const spec = providerSpec(config.provider);
  if (!spec) return null;
  const baseUrl = normalizeBaseUrl(config.baseUrl?.trim() || spec.defaultBaseUrl);
  const model = config.model?.trim() || spec.defaultModel;
  if (!baseUrl || !model) return null;
  return { protocol: spec.protocol, baseUrl, model };
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(describeUnreachable(url, err));
  }
  const body = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(body);
  } catch {
  }
  if (!res.ok) {
    const detail =
      (json.error as { message?: string } | undefined)?.message ??
      body.slice(0, 300) ??
      res.statusText;
    throw new BackendHttpError(res.status, `Backend returned ${res.status}: ${detail}`);
  }
  return json;
}

type Attempt = { text: string; model: string; truncated: boolean };

type TokenParam = "max_tokens" | "max_completion_tokens";

type TokenBudget = { maxTokens: number; param: TokenParam };

async function withTokenLimitRetry(
  budget: TokenBudget,
  attempt: (budget: TokenBudget) => Promise<Attempt>
): Promise<Attempt> {
  for (;;) {
    try {
      return await attempt(budget);
    } catch (err) {
      if (!(err instanceof BackendHttpError) || err.status !== 400) throw err;
      if (budget.param === "max_tokens" && /max_completion_tokens/i.test(err.message)) {
        budget.param = "max_completion_tokens";
        continue;
      }
      if (!/max_?tokens|output tokens|context length/i.test(err.message)) throw err;
      const named = err.message.match(/(?:at most|maximum(?:\s+\S+){0,4}?\s+is)\s*:?\s*(\d{3,7})/i)?.[1];
      const next =
        named && Number(named) < budget.maxTokens && Number(named) >= MIN_MAX_TOKENS
          ? Number(named)
          : Math.floor(budget.maxTokens / 2);
      if (next < MIN_MAX_TOKENS || next >= budget.maxTokens) throw err;
      budget.maxTokens = next;
    }
  }
}

export async function sendChat(
  config: BackendConfig,
  messages: CanonicalMessage[],
  system?: string,
  opts: SendOptions = {}
): Promise<ChatReply> {
  const resolved = resolveBackend(config);
  if (!resolved) {
    const spec = providerSpec(config.provider);
    if (!spec) throw new Error(`Unknown provider: ${config.provider}`);
    const missing = [
      !(config.baseUrl?.trim() || spec.defaultBaseUrl) && "a base URL",
      !(config.model?.trim() || spec.defaultModel) && "a model",
    ]
      .filter(Boolean)
      .join(" and ");
    throw new Error(`${spec.label} needs ${missing} configured — reconnect the backend.`);
  }
  const { protocol, baseUrl, model } = resolved;
  const wire = toWireMessages(messages);
  const key = config.apiKey ?? "";
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxContinuations = Math.max(0, opts.maxContinuations ?? MAX_CONTINUATIONS);
  const budget: TokenBudget = { maxTokens: opts.maxTokens ?? MAX_TOKENS, param: "max_tokens" };

  async function attemptAnthropic(partial: string, b: TokenBudget): Promise<Attempt> {
    const base = wire.filter((m) => m.role !== "system");
    const prefill = partial.trimEnd();
    const json = await fetchJson(
      `${baseUrl}/v1/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: b.maxTokens,
          ...(system ? { system } : {}),
          messages: prefill ? [...base, { role: "assistant", content: prefill }] : base,
        }),
      },
      timeoutMs
    );
    const blocks = Array.isArray(json.content) ? json.content : [];
    const text = blocks
      .filter((blk) => blk && (blk as { type?: string }).type === "text")
      .map((blk) => (blk as { text?: string }).text ?? "")
      .join("");
    return {
      text,
      model: typeof json.model === "string" ? json.model : model,
      truncated: json.stop_reason === "max_tokens",
    };
  }

  async function attemptGemini(partial: string): Promise<Attempt> {
    const contents = wire
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    if (partial) {
      contents.push(
        { role: "model", parts: [{ text: partial }] },
        { role: "user", parts: [{ text: CONTINUE_PROMPT }] }
      );
    }
    const systemText = [system, ...wire.filter((m) => m.role === "system").map((m) => m.content)]
      .filter(Boolean)
      .join("\n\n");
    const json = await fetchJson(
      `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
          contents,
        }),
      },
      timeoutMs
    );
    const candidates = json.candidates as
      | { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
      | undefined;
    const text = (candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    return { text, model, truncated: candidates?.[0]?.finishReason === "MAX_TOKENS" };
  }

  async function attemptOpenai(partial: string, b: TokenBudget): Promise<Attempt> {
    const base: WireMessage[] = system ? [{ role: "system", content: system }, ...wire] : wire;
    const openaiMessages: WireMessage[] = partial
      ? [...base, { role: "assistant", content: partial }, { role: "user", content: CONTINUE_PROMPT }]
      : base;
    let json: Record<string, unknown>;
    try {
      json = await fetchJson(
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(key ? { authorization: `Bearer ${key}` } : {}),
          },
          body: JSON.stringify({ model, messages: openaiMessages, [b.param]: b.maxTokens }),
        },
        timeoutMs
      );
    } catch (err) {
      if (err instanceof BackendHttpError && err.status === 404) {
        throw new BackendHttpError(
          404,
          `${err.message} — a 404 here usually means the Base URL is wrong (or the model name doesn't exist). ` +
            `The Base URL should be the API root, usually ending in /v1 — e.g. https://ollama.com/v1 for Ollama cloud ` +
            `or http://localhost:11434/v1 for local Ollama — without /chat/completions.`
        );
      }
      throw err;
    }
    const choice = (
      json.choices as { message?: { content?: string }; finish_reason?: string }[] | undefined
    )?.[0];
    return {
      text: choice?.message?.content ?? "",
      model: typeof json.model === "string" ? json.model : model,
      truncated: choice?.finish_reason === "length" || choice?.finish_reason === "max_tokens",
    };
  }

  let acc = "";
  let replyModel = model;
  let truncated = false;
  for (let round = 0; ; round++) {
    const attempt = await withTokenLimitRetry(budget, (b) =>
      protocol === "anthropic"
        ? attemptAnthropic(acc, b)
        : protocol === "gemini"
          ? attemptGemini(acc)
          : attemptOpenai(acc, b)
    );
    acc = protocol === "anthropic" && acc ? acc.trimEnd() + attempt.text : acc + attempt.text;
    if (attempt.model) replyModel = attempt.model;
    truncated = attempt.truncated;
    if (!truncated || round >= maxContinuations || !attempt.text) break;
  }

  const { text, reasoning } = stripThinking(acc);
  return { text: text || reasoning, model: replyModel, truncated };
}
