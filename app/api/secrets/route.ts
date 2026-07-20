import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { encryptionAvailable } from "@/lib/backends/crypto";
import {
  isValidSecretName,
  LocalSecretProvider,
  SECRET_COLUMNS,
  SECRET_KINDS,
  type SecretKind,
} from "@/lib/secrets/provider";
import { SECRET_NAME_HINT } from "@/lib/secrets/name";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_SECRETS = 100;
const MAX_VALUE_BYTES = 64 * 1024;

async function requireHuman(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return { error: auth.error, status: auth.status } as const;
  if (auth.identity.via === "api-key") {
    return { error: "API keys cannot manage the vault — use a signed-in session.", status: 403 } as const;
  }
  return { identity: auth.identity } as const;
}

export async function GET(req: NextRequest) {
  const auth = await requireHuman(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data, error } = await admin
    .from("user_secrets")
    .select(SECRET_COLUMNS)
    .eq("user_id", auth.identity.userId)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ secrets: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireHuman(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  if (!isValidSecretName(body.name)) {
    return NextResponse.json({ error: `name must be ${SECRET_NAME_HINT}` }, { status: 400 });
  }
  if (typeof body.value !== "string" || body.value.length === 0) {
    return NextResponse.json({ error: "value is required." }, { status: 400 });
  }
  if (Buffer.byteLength(body.value, "utf8") > MAX_VALUE_BYTES) {
    return NextResponse.json({ error: "value is too large (max 64 KB)." }, { status: 400 });
  }
  const kind: SecretKind =
    typeof body.kind === "string" && SECRET_KINDS.includes(body.kind as SecretKind)
      ? (body.kind as SecretKind)
      : "opaque";
  const description =
    typeof body.description === "string" ? body.description.slice(0, 500) : null;

  if (!encryptionAvailable()) {
    return NextResponse.json(
      { error: "Server-side encryption is not configured (HYPERVAULT_KEY_SECRET) — cannot store secrets." },
      { status: 503 }
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { count } = await admin
    .from("user_secrets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.identity.userId);
  if ((count ?? 0) >= MAX_SECRETS) {
    return NextResponse.json({ error: `Limit of ${MAX_SECRETS} secrets reached.` }, { status: 400 });
  }

  const provider = new LocalSecretProvider(admin, auth.identity.userId);
  try {
    const secret = await provider.create({ name: body.name, value: body.value, kind, description });
    return NextResponse.json({ secret });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "23505") {
      return NextResponse.json({ error: "A secret with that name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: e.message ?? "Could not create the secret." }, { status: 500 });
  }
}
