
import { createHash, randomBytes } from "crypto";

const DISCOVERY_TIMEOUT_MS = 10_000;
export const TOKEN_EXPIRY_SKEW_MS = 60_000;

export type OAuthChallenge = {
  resourceMetadataUrl: string | null;
  scope: string | null;
};

export type AuthServerMetadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
  scopesSupported: string[];
};

export type ClientRegistration = {
  clientId: string;
  clientSecret: string | null;
};

export type OAuthGrant = {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string | null;
  resource: string;
  tokenType: string;
};

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string | null;
  tokenType: string;
};

async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<{ status: number; ok: boolean; body: unknown }> {
  const { timeoutMs = DISCOVERY_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    const text = await res.text();
    let body: unknown = null;
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: res.status, ok: res.ok, body };
  } finally {
    clearTimeout(timer);
  }
}

export function parseWwwAuthenticate(header: string | null): OAuthChallenge {
  const out: OAuthChallenge = { resourceMetadataUrl: null, scope: null };
  if (!header) return out;
  for (const m of header.matchAll(/([a-zA-Z_-]+)\s*=\s*"([^"]*)"/g)) {
    const key = m[1].toLowerCase();
    if (key === "resource_metadata") out.resourceMetadataUrl = m[2];
    else if (key === "scope") out.scope = m[2];
  }
  return out;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(): string {
  return b64url(randomBytes(24));
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function readProtectedResource(body: unknown): { authorizationServer: string; resource: string | null; scopes: string[] } | null {
  if (!body || typeof body !== "object") return null;
  const meta = body as Record<string, unknown>;
  const servers = Array.isArray(meta.authorization_servers) ? meta.authorization_servers : [];
  const first = asString(servers[0]);
  if (!first) return null;
  const scopes = Array.isArray(meta.scopes_supported)
    ? (meta.scopes_supported.filter((s) => typeof s === "string") as string[])
    : [];
  return { authorizationServer: first, resource: asString(meta.resource), scopes };
}

function readAuthServerMetadata(body: unknown): AuthServerMetadata | null {
  if (!body || typeof body !== "object") return null;
  const meta = body as Record<string, unknown>;
  const authorizationEndpoint = asString(meta.authorization_endpoint);
  const tokenEndpoint = asString(meta.token_endpoint);
  const issuer = asString(meta.issuer);
  if (!authorizationEndpoint || !tokenEndpoint) return null;
  const scopesSupported = Array.isArray(meta.scopes_supported)
    ? (meta.scopes_supported.filter((s) => typeof s === "string") as string[])
    : [];
  return {
    issuer: issuer ?? "",
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: asString(meta.registration_endpoint),
    scopesSupported,
  };
}

function metadataCandidates(issuer: string): string[] {
  let u: URL;
  try {
    u = new URL(issuer);
  } catch {
    return [];
  }
  const path = u.pathname.replace(/\/$/, "");
  const origin = u.origin;
  const candidates = new Set<string>();
  if (path && path !== "") {
    candidates.add(`${origin}/.well-known/oauth-authorization-server${path}`);
    candidates.add(`${origin}/.well-known/openid-configuration${path}`);
    candidates.add(`${origin}${path}/.well-known/oauth-authorization-server`);
    candidates.add(`${origin}${path}/.well-known/openid-configuration`);
  } else {
    candidates.add(`${origin}/.well-known/oauth-authorization-server`);
    candidates.add(`${origin}/.well-known/openid-configuration`);
  }
  return [...candidates];
}

function protectedResourceCandidates(serverUrl: string, explicit: string | null): string[] {
  const candidates = new Set<string>();
  if (explicit) candidates.add(explicit);
  try {
    const u = new URL(serverUrl);
    const path = u.pathname.replace(/\/$/, "");
    candidates.add(`${u.origin}/.well-known/oauth-protected-resource${path}`);
    candidates.add(`${u.origin}/.well-known/oauth-protected-resource`);
  } catch {
  }
  return [...candidates];
}

export type DiscoveredAuth = {
  metadata: AuthServerMetadata;
  resource: string;
  scopesSupported: string[];
};

export async function discoverAuthorization(
  serverUrl: string,
  challenge: OAuthChallenge
): Promise<DiscoveredAuth | null> {
  let resource = serverUrl;
  let issuer: string | null = null;
  let scopes: string[] = [];

  for (const candidate of protectedResourceCandidates(serverUrl, challenge.resourceMetadataUrl)) {
    try {
      const res = await fetchJson(candidate, { headers: { accept: "application/json" } });
      if (!res.ok) continue;
      const parsed = readProtectedResource(res.body);
      if (parsed) {
        issuer = parsed.authorizationServer;
        resource = parsed.resource ?? serverUrl;
        scopes = parsed.scopes;
        break;
      }
    } catch {
    }
  }

  if (!issuer) {
    try {
      issuer = new URL(serverUrl).origin;
    } catch {
      return null;
    }
  }

  for (const candidate of metadataCandidates(issuer)) {
    try {
      const res = await fetchJson(candidate, { headers: { accept: "application/json" } });
      if (!res.ok) continue;
      const metadata = readAuthServerMetadata(res.body);
      if (metadata) {
        return {
          metadata,
          resource,
          scopesSupported: scopes.length > 0 ? scopes : metadata.scopesSupported,
        };
      }
    } catch {
    }
  }
  return null;
}

export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  clientName = "HyperVault"
): Promise<ClientRegistration | null> {
  try {
    const res = await fetchJson(registrationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: "web",
      }),
    });
    if (!res.ok || !res.body || typeof res.body !== "object") return null;
    const meta = res.body as Record<string, unknown>;
    const clientId = asString(meta.client_id);
    if (!clientId) return null;
    return { clientId, clientSecret: asString(meta.client_secret) };
  } catch {
    return null;
  }
}

export function buildAuthorizationUrl(params: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  resource: string;
  scope: string | null;
}): string {
  const url = new URL(params.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  url.searchParams.set("resource", params.resource);
  if (params.scope) url.searchParams.set("scope", params.scope);
  return url.toString();
}

function expiresAtFrom(body: Record<string, unknown>): string | null {
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : null;
  if (expiresIn === null) return null;
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

function readTokenResponse(body: unknown): TokenSet | null {
  if (!body || typeof body !== "object") return null;
  const meta = body as Record<string, unknown>;
  const accessToken = asString(meta.access_token);
  if (!accessToken) return null;
  return {
    accessToken,
    refreshToken: asString(meta.refresh_token),
    expiresAt: expiresAtFrom(meta),
    scope: asString(meta.scope),
    tokenType: asString(meta.token_type) ?? "Bearer",
  };
}

function tokenAuthHeaders(clientId: string, clientSecret: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }
  return headers;
}

export async function exchangeCode(params: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string | null;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string;
}): Promise<TokenSet> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.codeVerifier,
    resource: params.resource,
  });
  const res = await fetchJson(params.tokenEndpoint, {
    method: "POST",
    headers: tokenAuthHeaders(params.clientId, params.clientSecret),
    body: form.toString(),
  });
  const token = readTokenResponse(res.body);
  if (!res.ok || !token) {
    throw new Error(tokenErrorMessage(res.body) ?? `Token exchange failed (HTTP ${res.status}).`);
  }
  return token;
}

export async function refreshAccessToken(params: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string | null;
  refreshToken: string;
  resource: string;
  scope: string | null;
}): Promise<TokenSet> {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    resource: params.resource,
  });
  if (params.scope) form.set("scope", params.scope);
  const res = await fetchJson(params.tokenEndpoint, {
    method: "POST",
    headers: tokenAuthHeaders(params.clientId, params.clientSecret),
    body: form.toString(),
  });
  const token = readTokenResponse(res.body);
  if (!res.ok || !token) {
    throw new Error(tokenErrorMessage(res.body) ?? `Token refresh failed (HTTP ${res.status}).`);
  }
  return { ...token, refreshToken: token.refreshToken ?? params.refreshToken };
}

function tokenErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const meta = body as Record<string, unknown>;
  const err = asString(meta.error);
  const desc = asString(meta.error_description);
  if (err && desc) return `${err}: ${desc}`;
  return err ?? desc;
}

export function grantNeedsRefresh(grant: OAuthGrant, now = Date.now()): boolean {
  if (!grant.accessToken) return true;
  if (!grant.expiresAt) return false;
  const expiry = Date.parse(grant.expiresAt);
  if (Number.isNaN(expiry)) return false;
  return expiry - now <= TOKEN_EXPIRY_SKEW_MS;
}
