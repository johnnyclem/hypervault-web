import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { normalizeBaseUrl } from "@/lib/backends/chat";
import { decryptSecret, encryptionAvailable, encryptSecret } from "@/lib/backends/crypto";
import { probeEmbeddingBackend } from "@/lib/backends/embeddings";
import { testBackend } from "@/lib/backends/probe";
import { mergeBackendPatch } from "@/lib/backends/update";
import { isCustomProvider, isProviderId, providerSpec, PROVIDERS } from "@/lib/backends/providers";
import {
  EMBEDDING_MIGRATION_HINT,
  isMissingEmbeddingColumn,
  isStaleProviderConstraint,
  PROVIDER_MIGRATION_HINT,
} from "@/lib/backends/schema-compat";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const MAX_BACKENDS = 20;

const BACKEND_COLUMNS = "id, name, provider, base_url, default_model, embedding_model, key_hint, created_at, last_used_at";
const BACKEND_COLUMNS_LEGACY = "id, name, provider, base_url, default_model, key_hint, created_at, last_used_at";

function withNullEmbedding<T extends Record<string, unknown>>(row: T): T & { embedding_model: null } {
  return { ...row, embedding_model: null };
}

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  let { data, error } = await admin
    .from("llm_backends")
    .select(BACKEND_COLUMNS)
    .eq("user_id", auth.identity.userId)
    .order("created_at", { ascending: false });

  if (error && isMissingEmbeddingColumn(error)) {
    const retry = await admin
      .from("llm_backends")
      .select(BACKEND_COLUMNS_LEGACY)
      .eq("user_id", auth.identity.userId)
      .order("created_at", { ascending: false });
    data = retry.data?.map(withNullEmbedding) ?? null;
    error = retry.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ backends: data ?? [], providers: Object.values(PROVIDERS) });
}

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const provider = typeof body.provider === "string" ? body.provider : "";
  if (!isProviderId(provider)) {
    return NextResponse.json(
      { error: `provider must be one of: ${Object.keys(PROVIDERS).join(", ")}` },
      { status: 400 }
    );
  }
  const spec = providerSpec(provider)!;

  const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";
  const baseUrl = typeof body.base_url === "string" ? normalizeBaseUrl(body.base_url) : "";
  const defaultModel = typeof body.default_model === "string" ? body.default_model.trim() : "";
  const embeddingModel = typeof body.embedding_model === "string" ? body.embedding_model.trim() : "";
  const name = (typeof body.name === "string" && body.name.trim()) || spec.label;
  const skipTest = body.skip_test === true;

  if (embeddingModel && spec.protocol !== "openai") {
    return NextResponse.json(
      { error: `${spec.label} can't serve embeddings — only OpenAI-protocol backends expose /embeddings.` },
      { status: 400 }
    );
  }

  if (spec.requiresKey && !apiKey) {
    return NextResponse.json({ error: `${spec.label} needs an API key.` }, { status: 400 });
  }
  if (isCustomProvider(provider) && !baseUrl) {
    return NextResponse.json({ error: "Custom endpoints need a base_url." }, { status: 400 });
  }
  if (isCustomProvider(provider) && !defaultModel) {
    return NextResponse.json({ error: "Custom endpoints need a default_model." }, { status: 400 });
  }
  if (apiKey && !encryptionAvailable()) {
    return NextResponse.json(
      { error: "Server can't store keys securely right now (encryption secret missing)." },
      { status: 503 }
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { count } = await admin
    .from("llm_backends")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.identity.userId);
  if ((count ?? 0) >= MAX_BACKENDS) {
    return NextResponse.json({ error: `Backend limit reached (${MAX_BACKENDS}).` }, { status: 400 });
  }

  let storedBaseUrl = baseUrl || null;
  let message = `${name} connected.`;
  if (!skipTest) {
    const probe = await testBackend({
      provider,
      baseUrl: storedBaseUrl,
      model: defaultModel || null,
      apiKey: apiKey || null,
    });
    if (!probe.ok) {
      return NextResponse.json({ error: `Connection test failed: ${probe.error}` }, { status: 400 });
    }
    message = `${name} connected — test reply received from ${probe.model}.`;
    if (baseUrl && probe.baseUrl && probe.baseUrl !== baseUrl) {
      storedBaseUrl = probe.baseUrl;
      message += ` Base URL corrected to ${probe.baseUrl}.`;
    }
  }

  if (embeddingModel && !skipTest) {
    const embedBaseUrl = (storedBaseUrl || spec.defaultBaseUrl).replace(/\/$/, "");
    const embedProbe = await probeEmbeddingBackend({
      baseUrl: embedBaseUrl,
      apiKey: apiKey || null,
      model: embeddingModel,
    });
    if (!embedProbe.ok) {
      return NextResponse.json({ error: `Embedding test failed: ${embedProbe.error}` }, { status: 400 });
    }
    message += ` Semantic recall enabled via ${embeddingModel}.`;
  }

  const row = {
    user_id: auth.identity.userId,
    name,
    provider,
    base_url: storedBaseUrl,
    default_model: defaultModel || null,
    api_key_cipher: apiKey ? encryptSecret(apiKey) : null,
    key_hint: apiKey ? `${apiKey.slice(0, 7)}…` : null,
  };

  let { data: inserted, error } = await admin
    .from("llm_backends")
    .insert({ ...row, embedding_model: embeddingModel || null })
    .select(BACKEND_COLUMNS)
    .single();

  if (error && isMissingEmbeddingColumn(error)) {
    if (embeddingModel) {
      return NextResponse.json({ error: EMBEDDING_MIGRATION_HINT }, { status: 400 });
    }
    const retry = await admin.from("llm_backends").insert(row).select(BACKEND_COLUMNS_LEGACY).single();
    inserted = retry.data ? withNullEmbedding(retry.data) : null;
    error = retry.error;
  }

  if (error && provider === "custom-anthropic" && isStaleProviderConstraint(error)) {
    return NextResponse.json({ error: PROVIDER_MIGRATION_HINT }, { status: 400 });
  }
  if (error || !inserted) {
    return NextResponse.json({ error: error?.message ?? "Could not save the backend." }, { status: 500 });
  }
  return NextResponse.json({ backend: inserted, message });
}

export async function PATCH(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const skipTest = body.skip_test === true;

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  let embeddingColumnMissing = false;
  let { data: stored, error: storedError } = await admin
    .from("llm_backends")
    .select("id, name, provider, base_url, default_model, embedding_model, api_key_cipher")
    .eq("id", id)
    .eq("user_id", auth.identity.userId)
    .maybeSingle();
  if (storedError && isMissingEmbeddingColumn(storedError)) {
    embeddingColumnMissing = true;
    ({ data: stored } = await admin
      .from("llm_backends")
      .select("id, name, provider, base_url, default_model, api_key_cipher")
      .eq("id", id)
      .eq("user_id", auth.identity.userId)
      .maybeSingle());
    stored = stored ? withNullEmbedding(stored) : null;
  }
  if (!stored) return NextResponse.json({ error: "Backend not found." }, { status: 404 });

  const merged = mergeBackendPatch(stored, body);
  if (!merged.ok) return NextResponse.json({ error: merged.error }, { status: 400 });

  if (merged.newApiKey && !encryptionAvailable()) {
    return NextResponse.json(
      { error: "Server can't store keys securely right now (encryption secret missing)." },
      { status: 503 }
    );
  }

  let testApiKey = merged.newApiKey;
  const needsTest = !skipTest && (merged.connectionChanged || merged.embeddingChanged);
  if (!testApiKey && stored.api_key_cipher) {
    testApiKey = decryptSecret(stored.api_key_cipher);
    if (!testApiKey && needsTest) {
      return NextResponse.json(
        { error: "The stored API key can't be read (encryption secret changed) — re-enter the key to update this backend." },
        { status: 400 }
      );
    }
  }

  let storedBaseUrl = merged.baseUrl;
  let message = `${merged.name} updated.`;
  if (!skipTest && merged.connectionChanged) {
    const probe = await testBackend({
      provider: stored.provider,
      baseUrl: storedBaseUrl,
      model: merged.defaultModel,
      apiKey: testApiKey,
    });
    if (!probe.ok) {
      return NextResponse.json({ error: `Connection test failed: ${probe.error}` }, { status: 400 });
    }
    message = `${merged.name} updated — test reply received from ${probe.model}.`;
    if (storedBaseUrl && probe.baseUrl && probe.baseUrl !== storedBaseUrl) {
      storedBaseUrl = probe.baseUrl;
      message += ` Base URL corrected to ${probe.baseUrl}.`;
    }
  }

  if (!skipTest && merged.embeddingChanged && merged.embeddingModel) {
    const embedBaseUrl = (storedBaseUrl || merged.spec.defaultBaseUrl).replace(/\/$/, "");
    const embedProbe = await probeEmbeddingBackend({
      baseUrl: embedBaseUrl,
      apiKey: testApiKey,
      model: merged.embeddingModel,
    });
    if (!embedProbe.ok) {
      return NextResponse.json({ error: `Embedding test failed: ${embedProbe.error}` }, { status: 400 });
    }
    message += ` Semantic recall enabled via ${merged.embeddingModel}.`;
  }

  if (embeddingColumnMissing && merged.embeddingModel) {
    return NextResponse.json({ error: EMBEDDING_MIGRATION_HINT }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    name: merged.name,
    base_url: storedBaseUrl,
    default_model: merged.defaultModel,
  };
  if (!embeddingColumnMissing) update.embedding_model = merged.embeddingModel;
  if (merged.newApiKey) {
    update.api_key_cipher = encryptSecret(merged.newApiKey);
    update.key_hint = `${merged.newApiKey.slice(0, 7)}…`;
  }

  let { data: updated, error } = await admin
    .from("llm_backends")
    .update(update)
    .eq("id", id)
    .eq("user_id", auth.identity.userId)
    .select(BACKEND_COLUMNS)
    .single();

  if (error && isMissingEmbeddingColumn(error)) {
    if (merged.embeddingModel) {
      return NextResponse.json({ error: EMBEDDING_MIGRATION_HINT }, { status: 400 });
    }
    delete update.embedding_model;
    const retry = await admin
      .from("llm_backends")
      .update(update)
      .eq("id", id)
      .eq("user_id", auth.identity.userId)
      .select(BACKEND_COLUMNS_LEGACY)
      .single();
    updated = retry.data ? withNullEmbedding(retry.data) : null;
    error = retry.error;
  }

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? "Could not save the backend." }, { status: 500 });
  }
  return NextResponse.json({ backend: updated, message });
}

export async function DELETE(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { error } = await admin
    .from("llm_backends")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.identity.userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: "Backend disconnected." });
}
