import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.HYPERVAULT_KEY_SECRET = "test-secret-for-mcp-auth";
});

import { encryptSecret } from "@/lib/backends/crypto";
import { decryptGrant, encryptGrant, resolveServerAuth } from "@/lib/smallchat/mcp-auth";
import type { OAuthGrant } from "@/lib/smallchat/oauth";

const grant: OAuthGrant = {
  tokenEndpoint: "https://auth.test/token",
  clientId: "cid",
  clientSecret: null,
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: null,
  scope: null,
  resource: "https://mcp.test/mcp",
  tokenType: "Bearer",
};

describe("grant cipher round-trip", () => {
  it("encrypts and decrypts a grant", () => {
    const cipher = encryptGrant(grant);
    expect(cipher).toBeTruthy();
    expect(decryptGrant(cipher)).toEqual(grant);
  });

  it("returns null for a missing or garbage cipher", () => {
    expect(decryptGrant(null)).toBeNull();
    expect(decryptGrant("not-a-cipher")).toBeNull();
  });
});

describe("resolveServerAuth", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns static headers untouched when there is no OAuth grant", async () => {
    const headers = { "content-type": "application/json" };
    const cipher = encryptSecret(JSON.stringify(headers));
    const out = await resolveServerAuth({ auth_headers_cipher: cipher, oauth_grant_cipher: null });
    expect(out).toEqual(headers);
  });

  it("presents the OAuth bearer for a fresh grant", async () => {
    const out = await resolveServerAuth({ auth_headers_cipher: null, oauth_grant_cipher: encryptGrant(grant) });
    expect(out.Authorization).toBe("Bearer access-1");
  });

  it("refreshes an expired token and persists the rotated grant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ access_token: "access-2", expires_in: 3600, token_type: "Bearer" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );

    const expired: OAuthGrant = { ...grant, expiresAt: "2000-01-01T00:00:00Z" };
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const admin = {
      from: () => ({
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            updates.push({ id, patch });
            return { error: null };
          },
        }),
      }),
    } as never;

    const out = await resolveServerAuth(
      { id: "srv-1", auth_headers_cipher: null, oauth_grant_cipher: encryptGrant(expired) },
      admin
    );
    expect(out.Authorization).toBe("Bearer access-2");
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("srv-1");
    const persisted = decryptGrant(updates[0].patch.oauth_grant_cipher as string);
    expect(persisted!.accessToken).toBe("access-2");
    expect(persisted!.refreshToken).toBe("refresh-1");
  });

  it("falls back to the stale token when refresh fails, so a 401 can re-prompt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
    const expired: OAuthGrant = { ...grant, expiresAt: "2000-01-01T00:00:00Z" };
    const out = await resolveServerAuth({ auth_headers_cipher: null, oauth_grant_cipher: encryptGrant(expired) });
    expect(out.Authorization).toBe("Bearer access-1");
  });
});
