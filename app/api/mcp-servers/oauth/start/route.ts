import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { encryptionAvailable, encryptSecret } from "@/lib/backends/crypto";
import { introspectMcpServer } from "@/lib/smallchat/introspect";
import { McpAuthError } from "@/lib/smallchat/jsonrpc";
import {
  buildAuthorizationUrl,
  discoverAuthorization,
  generatePkce,
  parseWwwAuthenticate,
  randomState,
  registerClient,
} from "@/lib/smallchat/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingToolkitsTableHint } from "@/lib/supabase/errors";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!encryptionAvailable()) {
    return NextResponse.json(
      { error: "Server-side encryption is not configured (HYPERVAULT_KEY_SECRET) — cannot store credentials." },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim().replace(/\/$/, "") : "";
  if (!/^https?:\/\/.+/.test(url)) {
    return NextResponse.json({ error: "url must be an absolute http(s) URL." }, { status: 400 });
  }
  const serverId = typeof body.server_id === "string" ? body.server_id : null;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) || null : null;
  const registryId = typeof body.registry_id === "string" ? body.registry_id.slice(0, 200) : null;

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  let wwwAuthenticate: string | null = null;
  try {
    const probe = await introspectMcpServer(url, {});
    if (probe.ok) {
      return NextResponse.json(
        { error: "This server doesn't require authorization.", oauth_available: false },
        { status: 409 }
      );
    }
    if (probe.authRequired) wwwAuthenticate = probe.wwwAuthenticate;
  } catch (err) {
    if (err instanceof McpAuthError) wwwAuthenticate = err.wwwAuthenticate;
  }

  const discovered = await discoverAuthorization(url, parseWwwAuthenticate(wwwAuthenticate));
  if (!discovered) {
    return NextResponse.json(
      {
        error: "This server doesn't advertise an OAuth login. Add an API token instead.",
        oauth_available: false,
      },
      { status: 409 }
    );
  }

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/mcp-servers/oauth/callback`;

  if (!discovered.metadata.registrationEndpoint) {
    return NextResponse.json(
      {
        error: "This server's OAuth provider requires manual app registration. Add an API token instead.",
        oauth_available: false,
      },
      { status: 409 }
    );
  }

  const client = await registerClient(discovered.metadata.registrationEndpoint, redirectUri);
  if (!client) {
    return NextResponse.json(
      {
        error: "Could not register with the server's OAuth provider. Add an API token instead.",
        oauth_available: false,
      },
      { status: 409 }
    );
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  void admin.from("mcp_oauth_flows").delete().eq("user_id", auth.identity.userId).lt("created_at", hourAgo);

  const { verifier, challenge } = generatePkce();
  const state = randomState();
  const scope = discovered.scopesSupported.length > 0 ? discovered.scopesSupported.join(" ") : null;

  const { error: insertError } = await admin.from("mcp_oauth_flows").insert({
    state,
    user_id: auth.identity.userId,
    server_id: serverId,
    url,
    name,
    registry_id: registryId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    authorization_endpoint: discovered.metadata.authorizationEndpoint,
    token_endpoint: discovered.metadata.tokenEndpoint,
    resource: discovered.resource,
    scope,
    client_cipher: encryptSecret(JSON.stringify({ clientId: client.clientId, clientSecret: client.clientSecret })),
  });
  if (insertError) {
    const hint = missingToolkitsTableHint(insertError);
    return NextResponse.json({ error: hint ?? insertError.message }, { status: hint ? 503 : 500 });
  }

  const authorizationUrl = buildAuthorizationUrl({
    authorizationEndpoint: discovered.metadata.authorizationEndpoint,
    clientId: client.clientId,
    redirectUri,
    codeChallenge: challenge,
    state,
    resource: discovered.resource,
    scope,
  });

  return NextResponse.json({ authorization_url: authorizationUrl });
}
