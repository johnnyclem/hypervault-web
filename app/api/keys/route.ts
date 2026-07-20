import { NextResponse, type NextRequest } from "next/server";
import { generateApiKey } from "@/lib/api-auth";
import { rateLimit } from "@/lib/ratelimit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";

export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in to create API keys." }, { status: 401 });

  const limited = rateLimit(`keys:${user.id}`, 5, 60_000);
  if (!limited.ok) return NextResponse.json({ error: "Too many keys too fast — take a breath." }, { status: 429 });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { raw, hash, prefix } = generateApiKey();
  const { error } = await admin.from("api_keys").insert({
    user_id: user.id,
    key_hash: hash,
    key_prefix: prefix,
  });
  if (error) return NextResponse.json({ error: `Could not create the key: ${error.message}` }, { status: 500 });

  return NextResponse.json({
    key: raw,
    prefix,
    message: "Copy this key now — it is never shown again. Use it as the X-HyperVault-Key header.",
  });
}

export async function DELETE(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in to revoke API keys." }, { status: 401 });

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

  const { data, error } = await admin
    .from("api_keys")
    .update({ revoked: true })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("revoked", false)
    .select("id");
  if (error) return NextResponse.json({ error: `Could not revoke the key: ${error.message}` }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "No such key — it may already be revoked." }, { status: 404 });
  }

  return NextResponse.json({ revoked: id });
}
