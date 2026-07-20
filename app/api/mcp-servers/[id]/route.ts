import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { encryptionAvailable, encryptSecret } from "@/lib/backends/crypto";
import { parseHeaders, publicServer, serverColumns } from "@/lib/smallchat/server-rows";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingToolkitsTableHint, missingVaultColumnHint } from "@/lib/supabase/errors";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (Array.isArray(body.disabled_tools)) {
    patch.disabled_tools = body.disabled_tools.filter((t) => typeof t === "string").slice(0, 500);
  }
  if ("headers" in body) {
    if (body.headers === null) {
      patch.auth_headers_cipher = null;
    } else {
      const headers = parseHeaders(body.headers);
      if (!headers) return NextResponse.json({ error: "headers must be an object of strings." }, { status: 400 });
      if (!encryptionAvailable()) {
        return NextResponse.json(
          { error: "Server-side encryption is not configured (HYPERVAULT_KEY_SECRET) — cannot store auth headers." },
          { status: 503 }
        );
      }
      patch.auth_headers_cipher = encryptSecret(JSON.stringify(headers));
    }
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const secretRefs: Array<["auth_headers_secret_id" | "oauth_grant_secret_id", "auth_headers_cipher" | "oauth_grant_cipher"]> = [
    ["auth_headers_secret_id", "auth_headers_cipher"],
    ["oauth_grant_secret_id", "oauth_grant_cipher"],
  ];
  for (const [refCol, cipherCol] of secretRefs) {
    if (!(refCol in body)) continue;
    const ref = body[refCol];
    if (ref === null) {
      patch[refCol] = null;
    } else if (typeof ref === "string") {
      const { data: owned } = await admin
        .from("user_secrets")
        .select("id")
        .eq("id", ref)
        .eq("user_id", auth.identity.userId)
        .maybeSingle();
      if (!owned) {
        return NextResponse.json({ error: `No such secret for ${refCol}.` }, { status: 404 });
      }
      patch[refCol] = ref;
      patch[cipherCol] = null;
    } else {
      return NextResponse.json({ error: `${refCol} must be a secret id or null.` }, { status: 400 });
    }
  }

  const { data, error } = await admin
    .from("mcp_servers")
    .update(patch)
    .eq("id", id)
    .eq("user_id", auth.identity.userId)
    .select(await serverColumns(admin))
    .maybeSingle()
    .returns<Record<string, unknown>>();
  if (error) {
    const hint = missingToolkitsTableHint(error) ?? missingVaultColumnHint(error);
    return NextResponse.json({ error: hint ?? error.message }, { status: hint ? 503 : 500 });
  }
  if (!data) return NextResponse.json({ error: "Server not found." }, { status: 404 });
  return NextResponse.json({ server: publicServer(data) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { error } = await admin.from("mcp_servers").delete().eq("id", id).eq("user_id", auth.identity.userId);
  if (error) {
    const hint = missingToolkitsTableHint(error);
    return NextResponse.json({ error: hint ?? error.message }, { status: hint ? 503 : 500 });
  }
  return NextResponse.json({
    ok: true,
    message: "Removed. Compiled toolkits keep working until you compile again.",
  });
}
