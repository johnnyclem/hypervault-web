import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { encryptionAvailable, decryptSecret, encryptSecret } from "@/lib/backends/crypto";
import { avError, BRIDGE_RATE_LIMIT } from "@/lib/polytician/bridge";
import { isValidSecretName, SECRET_COLUMNS, SECRET_KINDS, type SecretKind } from "@/lib/secrets/provider";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_VALUE_BYTES = 64 * 1024;

export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const auth = await resolveApiIdentity(req, { keyRateLimit: BRIDGE_RATE_LIMIT });
  if ("error" in auth) return avError(auth.status, "UNAUTHORIZED", auth.error);

  const { name } = await params;

  if (auth.identity.via !== "api-key" || !auth.identity.keyId) {
    return avError(403, "FORBIDDEN", "Secret values are only retrievable with a granted API key.");
  }
  if (!isValidSecretName(name)) {
    return avError(404, "NOT_FOUND", "No such secret.");
  }

  const admin = createAdminClient();
  if (!admin) return avError(503, "UNAVAILABLE", "Server is not configured with Supabase credentials.");

  const { data: secret } = await admin
    .from("user_secrets")
    .select("id, name, kind, value_cipher, user_id")
    .eq("user_id", auth.identity.userId)
    .eq("name", name)
    .maybeSingle();

  if (!secret) return avError(404, "NOT_FOUND", "No such secret.");

  const { data: grant } = await admin
    .from("secret_grants")
    .select("id")
    .eq("secret_id", secret.id as string)
    .eq("api_key_id", auth.identity.keyId)
    .maybeSingle();
  if (!grant) return avError(404, "NOT_FOUND", "No such secret.");

  const value = decryptSecret(secret.value_cipher as string);
  if (value === null) {
    return avError(500, "DECRYPT_FAILED", "The secret could not be decrypted (key rotated?).");
  }

  void admin
    .from("user_secrets")
    .update({ last_accessed_at: new Date().toISOString() })
    .eq("id", secret.id as string);

  return NextResponse.json({
    name: secret.name,
    kind: secret.kind,
    value,
  });
}

async function requireHuman(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return { error: auth.error, status: auth.status } as const;
  if (auth.identity.via === "api-key") {
    return { error: "API keys cannot manage the vault — use a signed-in session.", status: 403 } as const;
  }
  return { identity: auth.identity } as const;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const auth = await requireHuman(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { name } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("new_name" in body) {
    if (!isValidSecretName(body.new_name)) {
      return NextResponse.json({ error: "new_name must be a valid secret handle." }, { status: 400 });
    }
    patch.name = body.new_name;
  }
  if ("description" in body) {
    patch.description = typeof body.description === "string" ? body.description.slice(0, 500) : null;
  }
  if ("kind" in body) {
    if (typeof body.kind !== "string" || !SECRET_KINDS.includes(body.kind as SecretKind)) {
      return NextResponse.json({ error: "kind must be one of opaque, header, oauth_grant." }, { status: 400 });
    }
    patch.kind = body.kind;
  }
  if ("value" in body) {
    if (typeof body.value !== "string" || body.value.length === 0) {
      return NextResponse.json({ error: "value must be a non-empty string." }, { status: 400 });
    }
    if (Buffer.byteLength(body.value, "utf8") > MAX_VALUE_BYTES) {
      return NextResponse.json({ error: "value is too large (max 64 KB)." }, { status: 400 });
    }
    if (!encryptionAvailable()) {
      return NextResponse.json(
        { error: "Server-side encryption is not configured (HYPERVAULT_KEY_SECRET)." },
        { status: 503 }
      );
    }
    patch.value_cipher = encryptSecret(body.value);
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data, error } = await admin
    .from("user_secrets")
    .update(patch)
    .eq("user_id", auth.identity.userId)
    .eq("name", name)
    .select(SECRET_COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A secret with that name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "No such secret." }, { status: 404 });
  return NextResponse.json({ secret: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const auth = await requireHuman(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { name } = await params;

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data, error } = await admin
    .from("user_secrets")
    .delete()
    .eq("user_id", auth.identity.userId)
    .eq("name", name)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "No such secret." }, { status: 404 });
  return NextResponse.json({ ok: true, deleted: name });
}
