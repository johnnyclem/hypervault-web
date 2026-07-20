import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { sendChat } from "@/lib/backends/chat";
import { decryptSecret } from "@/lib/backends/crypto";
import { avError, BRIDGE_RATE_LIMIT } from "@/lib/polytician/bridge";
import { pickBackend, type InferenceBackendRow } from "@/lib/polytician/inference";
import { createAdminClient } from "@/lib/supabase/admin";


const MIN_MAX_TOKENS = 1_024;
const MAX_MAX_TOKENS = 16_384;

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req, { keyRateLimit: BRIDGE_RATE_LIMIT });
  if ("error" in auth) return avError(auth.status, "UNAUTHORIZED", auth.error);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return avError(400, "BAD_REQUEST", "Body must be JSON.");
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return avError(400, "BAD_REQUEST", "prompt is required.");
  const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt : undefined;
  const preferredBackend = typeof body.preferredBackend === "string" ? body.preferredBackend : undefined;
  const requestedMaxTokens = typeof body.maxTokens === "number" ? body.maxTokens : undefined;
  const maxTokens = requestedMaxTokens
    ? Math.min(Math.max(Math.floor(requestedMaxTokens), MIN_MAX_TOKENS), MAX_MAX_TOKENS)
    : undefined;

  const admin = createAdminClient();
  if (!admin) return avError(503, "NOT_CONFIGURED", "Server is not configured with Supabase credentials.");
  const userId = auth.identity.userId;

  const { data: backends, error } = await admin
    .from("llm_backends")
    .select("id, provider, base_url, default_model, api_key_cipher, last_used_at, created_at")
    .eq("user_id", userId);
  if (error) return avError(500, "BACKEND_LOOKUP_FAILED", error.message);

  const backend = pickBackend((backends ?? []) as InferenceBackendRow[], preferredBackend);
  if (!backend) {
    return avError(404, "NO_BACKEND", "No LLM backend is connected — add one in your vault settings first.");
  }

  const startedAt = Date.now();
  try {
    const reply = await sendChat(
      {
        provider: backend.provider,
        baseUrl: backend.base_url,
        model: backend.default_model,
        apiKey: backend.api_key_cipher ? decryptSecret(backend.api_key_cipher) : null,
      },
      [{ role: "user", content: prompt, attachments: [] }],
      systemPrompt,
      maxTokens ? { maxTokens } : {}
    );
    void admin.from("llm_backends").update({ last_used_at: new Date().toISOString() }).eq("id", backend.id);

    return NextResponse.json({
      text: reply.text,
      backend: `${backend.provider}:${reply.model}`,
      model: reply.model,
      truncated: reply.truncated,
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    return avError(502, "BACKEND_ERROR", err instanceof Error ? err.message : "The backend request failed.");
  }
}
