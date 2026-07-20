import { createHash } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthorizationUrl,
  discoverAuthorization,
  exchangeCode,
  generatePkce,
  grantNeedsRefresh,
  parseWwwAuthenticate,
  refreshAccessToken,
  registerClient,
  type OAuthGrant,
} from "@/lib/smallchat/oauth";

describe("parseWwwAuthenticate", () => {
  it("pulls resource_metadata and scope out of a Bearer challenge", () => {
    const c = parseWwwAuthenticate(
      'Bearer resource_metadata="https://mcp.test/.well-known/oauth-protected-resource", scope="read write"'
    );
    expect(c.resourceMetadataUrl).toBe("https://mcp.test/.well-known/oauth-protected-resource");
    expect(c.scope).toBe("read write");
  });

  it("tolerates a bare header and null", () => {
    expect(parseWwwAuthenticate("Bearer")).toEqual({ resourceMetadataUrl: null, scope: null });
    expect(parseWwwAuthenticate(null)).toEqual({ resourceMetadataUrl: null, scope: null });
  });
});

describe("generatePkce", () => {
  it("produces a challenge that is the S256 of the verifier", () => {
    const { verifier, challenge } = generatePkce();
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
    expect(verifier).not.toContain("=");
  });
});

describe("buildAuthorizationUrl", () => {
  it("carries every PKCE + RFC 8707 resource param", () => {
    const url = new URL(
      buildAuthorizationUrl({
        authorizationEndpoint: "https://auth.test/authorize",
        clientId: "abc",
        redirectUri: "https://app.test/cb",
        codeChallenge: "chal",
        state: "st",
        resource: "https://mcp.test/mcp",
        scope: "read",
      })
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("abc");
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("resource")).toBe("https://mcp.test/mcp");
    expect(url.searchParams.get("scope")).toBe("read");
  });

  it("omits scope when none is given", () => {
    const url = new URL(
      buildAuthorizationUrl({
        authorizationEndpoint: "https://auth.test/authorize",
        clientId: "abc",
        redirectUri: "https://app.test/cb",
        codeChallenge: "chal",
        state: "st",
        resource: "https://mcp.test/mcp",
        scope: null,
      })
    );
    expect(url.searchParams.has("scope")).toBe(false);
  });
});

describe("grantNeedsRefresh", () => {
  const base: OAuthGrant = {
    tokenEndpoint: "https://auth.test/token",
    clientId: "c",
    clientSecret: null,
    accessToken: "tok",
    refreshToken: "r",
    expiresAt: null,
    scope: null,
    resource: "https://mcp.test/mcp",
    tokenType: "Bearer",
  };

  it("never refreshes a non-expiring token", () => {
    expect(grantNeedsRefresh(base)).toBe(false);
  });

  it("refreshes inside the skew window and past expiry", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(grantNeedsRefresh({ ...base, expiresAt: "2026-01-01T00:00:30Z" }, now)).toBe(true);
    expect(grantNeedsRefresh({ ...base, expiresAt: "2025-12-31T23:59:00Z" }, now)).toBe(true);
    expect(grantNeedsRefresh({ ...base, expiresAt: "2026-01-01T01:00:00Z" }, now)).toBe(false);
  });
});

describe("discoverAuthorization", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("walks protected-resource → auth-server metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://mcp.test/.well-known/oauth-protected-resource/mcp") {
          return new Response(
            JSON.stringify({
              resource: "https://mcp.test/mcp",
              authorization_servers: ["https://auth.test"],
              scopes_supported: ["read"],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url === "https://auth.test/.well-known/oauth-authorization-server") {
          return new Response(
            JSON.stringify({
              issuer: "https://auth.test",
              authorization_endpoint: "https://auth.test/authorize",
              token_endpoint: "https://auth.test/token",
              registration_endpoint: "https://auth.test/register",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response("not found", { status: 404 });
      })
    );

    const result = await discoverAuthorization("https://mcp.test/mcp", {
      resourceMetadataUrl: "https://mcp.test/.well-known/oauth-protected-resource/mcp",
      scope: null,
    });
    expect(result).not.toBeNull();
    expect(result!.metadata.tokenEndpoint).toBe("https://auth.test/token");
    expect(result!.metadata.registrationEndpoint).toBe("https://auth.test/register");
    expect(result!.resource).toBe("https://mcp.test/mcp");
    expect(result!.scopesSupported).toEqual(["read"]);
  });

  it("falls back to probing the server origin when there is no protected-resource doc", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://mcp.test/.well-known/oauth-authorization-server") {
          return new Response(
            JSON.stringify({
              issuer: "https://mcp.test",
              authorization_endpoint: "https://mcp.test/authorize",
              token_endpoint: "https://mcp.test/token",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response("not found", { status: 404 });
      })
    );

    const result = await discoverAuthorization("https://mcp.test", { resourceMetadataUrl: null, scope: null });
    expect(result).not.toBeNull();
    expect(result!.metadata.authorizationEndpoint).toBe("https://mcp.test/authorize");
    expect(result!.metadata.registrationEndpoint).toBeNull();
  });

  it("returns null when no metadata is discoverable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    const result = await discoverAuthorization("https://mcp.test/mcp", { resourceMetadataUrl: null, scope: null });
    expect(result).toBeNull();
  });
});

describe("registerClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("registers a public client and returns its id", async () => {
    const seen: { body: unknown } = { body: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.body = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ client_id: "cid-1" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      })
    );
    const reg = await registerClient("https://auth.test/register", "https://app.test/cb");
    expect(reg).toEqual({ clientId: "cid-1", clientSecret: null });
    expect((seen.body as Record<string, unknown>).redirect_uris).toEqual(["https://app.test/cb"]);
    expect((seen.body as Record<string, unknown>).token_endpoint_auth_method).toBe("none");
  });

  it("returns null when registration is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
    expect(await registerClient("https://auth.test/register", "https://app.test/cb")).toBeNull();
  });
});

describe("token endpoints", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exchanges a code with PKCE + resource in the body", async () => {
    let form: URLSearchParams | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        form = new URLSearchParams(init.body as string);
        return new Response(
          JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "Bearer" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );
    const token = await exchangeCode({
      tokenEndpoint: "https://auth.test/token",
      clientId: "cid",
      clientSecret: null,
      code: "code123",
      redirectUri: "https://app.test/cb",
      codeVerifier: "ver",
      resource: "https://mcp.test/mcp",
    });
    expect(token.accessToken).toBe("at");
    expect(token.refreshToken).toBe("rt");
    expect(token.expiresAt).not.toBeNull();
    expect(form!.get("grant_type")).toBe("authorization_code");
    expect(form!.get("code_verifier")).toBe("ver");
    expect(form!.get("resource")).toBe("https://mcp.test/mcp");
  });

  it("keeps the old refresh token when the server omits a rotated one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ access_token: "at2", token_type: "Bearer" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    const token = await refreshAccessToken({
      tokenEndpoint: "https://auth.test/token",
      clientId: "cid",
      clientSecret: null,
      refreshToken: "keep-me",
      resource: "https://mcp.test/mcp",
      scope: null,
    });
    expect(token.accessToken).toBe("at2");
    expect(token.refreshToken).toBe("keep-me");
  });

  it("throws a useful message on an OAuth error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "invalid_grant", error_description: "expired" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        })
      )
    );
    await expect(
      exchangeCode({
        tokenEndpoint: "https://auth.test/token",
        clientId: "cid",
        clientSecret: null,
        code: "x",
        redirectUri: "https://app.test/cb",
        codeVerifier: "v",
        resource: "https://mcp.test/mcp",
      })
    ).rejects.toThrow(/invalid_grant: expired/);
  });
});
