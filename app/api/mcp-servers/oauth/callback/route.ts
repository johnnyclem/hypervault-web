import { NextResponse, type NextRequest } from "next/server";
import { decryptSecret } from "@/lib/backends/crypto";
import { introspectMcpServer } from "@/lib/smallchat/introspect";
import { encryptGrant } from "@/lib/smallchat/mcp-auth";
import { exchangeCode, type OAuthGrant } from "@/lib/smallchat/oauth";
import { publicServer, serverColumns } from "@/lib/smallchat/server-rows";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";

export const maxDuration = 60;

type FlowRow = {
  state: string;
  user_id: string;
  server_id: string | null;
  url: string;
  name: string | null;
  registry_id: string | null;
  redirect_uri: string;
  code_verifier: string;
  token_endpoint: string;
  resource: string;
  scope: string | null;
  client_cipher: string;
};

function resultPage(payload: Record<string, unknown>): NextResponse {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  const ok = payload.ok === true;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${ok ? "Connected" : "Authorization failed"}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#111;color:#eee;display:flex;
    min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center}
  .card{max-width:22rem;padding:2rem}
  h1{font-size:1.1rem;margin:0 0 .5rem} p{color:#aaa;font-size:.9rem;margin:0}
</style></head>
<body><div class="card">
  <h1>${ok ? "✓ Connected" : "Authorization failed"}</h1>
  <p>${ok ? "You can close this window." : String(payload.error ?? "Something went wrong.")}</p>
</div>
<script>
  (function () {
    var payload = ${json};
    try { if (window.opener) window.opener.postMessage(Object.assign({ type: "mcp-oauth" }, payload), window.location.origin); } catch (e) {}
    setTimeout(function () { try { window.close(); } catch (e) {} }, ${ok ? 1200 : 4000});
  })();
</script>
</body></html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const providerError = searchParams.get("error");

  if (providerError) {
    return resultPage({ ok: false, error: searchParams.get("error_description") ?? providerError });
  }
  if (!code || !state) {
    return resultPage({ ok: false, error: "The authorization response was incomplete." });
  }

  const admin = createAdminClient();
  if (!admin) return resultPage({ ok: false, error: "Server is not configured with Supabase credentials." });

  const { data: flow } = await admin.from("mcp_oauth_flows").select("*").eq("state", state).maybeSingle<FlowRow>();
  if (!flow) return resultPage({ ok: false, error: "This login link has expired — start over." });

  await admin.from("mcp_oauth_flows").delete().eq("state", state);

  const user = await getUser();
  if (!user || user.id !== flow.user_id) {
    return resultPage({ ok: false, error: "Sign in as the account that started this connection, then try again." });
  }

  let client: { clientId: string; clientSecret: string | null };
  try {
    const plain = decryptSecret(flow.client_cipher);
    client = JSON.parse(plain ?? "") as { clientId: string; clientSecret: string | null };
    if (!client.clientId) throw new Error("missing client id");
  } catch {
    return resultPage({ ok: false, error: "Stored client credentials could not be read — start over." });
  }

  let grant: OAuthGrant;
  try {
    const token = await exchangeCode({
      tokenEndpoint: flow.token_endpoint,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      code,
      redirectUri: flow.redirect_uri,
      codeVerifier: flow.code_verifier,
      resource: flow.resource,
    });
    grant = {
      tokenEndpoint: flow.token_endpoint,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      scope: token.scope ?? flow.scope,
      resource: flow.resource,
      tokenType: token.tokenType,
    };
  } catch (err) {
    return resultPage({ ok: false, error: err instanceof Error ? err.message : "Token exchange failed." });
  }

  const probe = await introspectMcpServer(flow.url, {
    Authorization: `${grant.tokenType || "Bearer"} ${grant.accessToken}`,
  });
  if (!probe.ok) {
    return resultPage({ ok: false, error: `Authorized, but the server didn't accept the token: ${probe.error}` });
  }

  const grantCipher = encryptGrant(grant);
  const now = new Date().toISOString();
  const serverName = flow.name || probe.serverName || new URL(flow.url).hostname;

  const record: Record<string, unknown> = {
    user_id: flow.user_id,
    name: serverName,
    url: flow.url,
    oauth_grant_cipher: grantCipher,
    tools_cache: probe.tools,
    introspected_at: now,
    updated_at: now,
  };
  if (flow.registry_id) record.registry_id = flow.registry_id;

  const { data: saved, error } = await admin
    .from("mcp_servers")
    .upsert(record, { onConflict: "user_id,url" })
    .select(await serverColumns(admin))
    .single()
    .returns<Record<string, unknown>>();

  if (error || !saved) {
    return resultPage({ ok: false, error: `Authorized, but saving the connection failed: ${error?.message ?? "unknown"}` });
  }

  return resultPage({
    ok: true,
    server: publicServer(saved),
    message: `Connected — ${probe.tools.length} tool${probe.tools.length === 1 ? "" : "s"} discovered.`,
  });
}
