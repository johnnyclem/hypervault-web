import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireHuman(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return { error: auth.error, status: auth.status } as const;
  if (auth.identity.via === "api-key") {
    return { error: "API keys cannot manage grants — use a signed-in session.", status: 403 } as const;
  }
  return { identity: auth.identity } as const;
}

async function ownSecretId(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  name: string
): Promise<string | null> {
  const { data } = await admin!
    .from("user_secrets")
    .select("id")
    .eq("user_id", userId)
    .eq("name", name)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const auth = await requireHuman(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { name } = await params;

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const secretId = await ownSecretId(admin, auth.identity.userId, name);
  if (!secretId) return NextResponse.json({ error: "No such secret." }, { status: 404 });

  const { data, error } = await admin
    .from("secret_grants")
    .select("id, api_key_id, created_at")
    .eq("secret_id", secretId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ grants: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const auth = await requireHuman(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { name } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const apiKeyId = typeof body.api_key_id === "string" ? body.api_key_id : "";
  if (!apiKeyId) return NextResponse.json({ error: "api_key_id is required." }, { status: 400 });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const secretId = await ownSecretId(admin, auth.identity.userId, name);
  if (!secretId) return NextResponse.json({ error: "No such secret." }, { status: 404 });

  const { data: key } = await admin
    .from("api_keys")
    .select("id")
    .eq("id", apiKeyId)
    .eq("user_id", auth.identity.userId)
    .maybeSingle();
  if (!key) return NextResponse.json({ error: "No such API key." }, { status: 404 });

  const { data, error } = await admin
    .from("secret_grants")
    .upsert(
      { user_id: auth.identity.userId, secret_id: secretId, api_key_id: apiKeyId },
      { onConflict: "secret_id,api_key_id" }
    )
    .select("id, api_key_id, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ grant: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const auth = await requireHuman(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { name } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const apiKeyId = typeof body.api_key_id === "string" ? body.api_key_id : "";
  if (!apiKeyId) return NextResponse.json({ error: "api_key_id is required." }, { status: 400 });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const secretId = await ownSecretId(admin, auth.identity.userId, name);
  if (!secretId) return NextResponse.json({ error: "No such secret." }, { status: 404 });

  const { data, error } = await admin
    .from("secret_grants")
    .delete()
    .eq("secret_id", secretId)
    .eq("api_key_id", apiKeyId)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "No such grant." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
