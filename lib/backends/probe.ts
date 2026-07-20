import {
  BackendHttpError,
  normalizeBaseUrl,
  sendChat,
  type BackendConfig,
} from "@/lib/backends/chat";
import { providerSpec } from "@/lib/backends/providers";


const PING_TIMEOUT_MS = 30_000;
const PING_MAX_TOKENS = 16;

export type ProbeResult =
  | { ok: true; baseUrl: string | null; model: string }
  | { ok: false; error: string };

export function baseUrlCandidates(raw: string): string[] {
  const normalized = normalizeBaseUrl(raw);
  const candidates = [normalized];
  if (!/\/v1$/.test(normalized)) candidates.push(`${normalized}/v1`);
  try {
    const originV1 = `${new URL(normalized).origin}/v1`;
    if (!candidates.includes(originV1)) candidates.push(originV1);
  } catch {
  }
  return candidates;
}

export function anthropicBaseUrlCandidates(raw: string): string[] {
  const normalized = normalizeBaseUrl(raw);
  const candidates = [normalized];
  const withoutV1 = normalized.replace(/\/v1$/, "");
  if (withoutV1 && withoutV1 !== normalized) candidates.push(withoutV1);
  return candidates;
}

export async function testBackend(config: BackendConfig): Promise<ProbeResult> {
  const spec = providerSpec(config.provider);
  if (!spec) return { ok: false, error: `Unknown provider: ${config.provider}` };

  const raw = config.baseUrl?.trim() ?? "";
  const candidates: (string | null)[] = !raw
    ? [null]
    : spec.protocol === "openai"
      ? baseUrlCandidates(raw)
      : spec.protocol === "anthropic"
        ? anthropicBaseUrlCandidates(raw)
        : [raw];

  const ping = [{ role: "user" as const, content: "Reply with the single word: ok", attachments: [] }];
  let firstError: string | null = null;

  for (const candidate of candidates) {
    try {
      const reply = await sendChat({ ...config, baseUrl: candidate }, ping, undefined, {
        maxTokens: PING_MAX_TOKENS,
        timeoutMs: PING_TIMEOUT_MS,
        maxContinuations: 0,
      });
      return { ok: true, baseUrl: candidate, model: reply.model };
    } catch (err) {
      const message = err instanceof Error ? err.message : "The test request failed.";
      firstError ??= message;
      if (!(err instanceof BackendHttpError && err.status === 404)) {
        return { ok: false, error: message };
      }
    }
  }
  return { ok: false, error: firstError ?? "The test request failed." };
}
