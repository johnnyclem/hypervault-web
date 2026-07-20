import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.HYPERVAULT_KEY_SECRET = "test-secret-for-vault-auth";
});

import { encryptSecret } from "@/lib/backends/crypto";
import { decryptGrant, encryptGrant, resolveServerAuth } from "@/lib/smallchat/mcp-auth";
import type { OAuthGrant } from "@/lib/smallchat/oauth";

const grant: OAuthGrant = {
  tokenEndpoint: "https://auth.test/token",
  clientId: "cid",
  clientSecret: null,
  accessToken: "vault-access",
  refreshToken: "vault-refresh",
  expiresAt: null,
  scope: null,
  resource: "https://mcp.test/mcp",
  tokenType: "Bearer",
};

type Write = { table: string; patch: Record<string, unknown>; id: string };

function makeAdmin(secrets: Record<string, string | undefined>, writes: Write[]) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        update(p: Record<string, unknown>) {
          patch = p;
          return builder;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          if (patch) {
            writes.push({ table, patch, id: filters.id as string });
            return Promise.resolve({ error: null });
          }
          return builder;
        },
        async maybeSingle() {
          const cipher = secrets[filters.id as string];
          return { data: cipher ? { value_cipher: cipher } : null, error: null };
        },
      };
      return builder;
    },
  } as never;
}

describe("resolveServerAuth — AgentVault references", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prefers the referenced secret over the inline cipher", async () => {
    const inline = encryptGrant({ ...grant, accessToken: "inline-access" })!;
    const vaultCipher = encryptGrant(grant)!;
    const admin = makeAdmin({ "sec-1": vaultCipher }, []);

    const out = await resolveServerAuth(
      {
        id: "srv-1",
        user_id: "user-1",
        auth_headers_cipher: null,
        oauth_grant_cipher: inline,
        oauth_grant_secret_id: "sec-1",
      },
      admin
    );
    expect(out.Authorization).toBe("Bearer vault-access");
  });

  it("falls back to the inline cipher when the reference is dangling", async () => {
    const inline = encryptGrant({ ...grant, accessToken: "inline-access" })!;
    const admin = makeAdmin({ }, []);

    const out = await resolveServerAuth(
      {
        id: "srv-1",
        user_id: "user-1",
        auth_headers_cipher: null,
        oauth_grant_cipher: inline,
        oauth_grant_secret_id: "sec-1",
      },
      admin
    );
    expect(out.Authorization).toBe("Bearer inline-access");
  });

  it("dereferences a vault-backed header secret", async () => {
    const headers = { "X-Api-Key": "from-vault" };
    const admin = makeAdmin({ "sec-h": encryptSecret(JSON.stringify(headers))! }, []);

    const out = await resolveServerAuth(
      {
        user_id: "user-1",
        auth_headers_cipher: null,
        oauth_grant_cipher: null,
        auth_headers_secret_id: "sec-h",
      },
      admin
    );
    expect(out).toEqual(headers);
  });

  it("does not touch the vault without a user_id (frozen snapshot)", async () => {
    const admin = makeAdmin({ "sec-1": encryptGrant(grant)! }, []);
    const out = await resolveServerAuth(
      { auth_headers_cipher: null, oauth_grant_cipher: null, oauth_grant_secret_id: "sec-1" },
      admin
    );
    expect(out.Authorization).toBeUndefined();
  });

  it("writes a rotated grant back to the SECRET, not the mcp_servers row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ access_token: "rotated", expires_in: 3600, token_type: "Bearer" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    const expired: OAuthGrant = { ...grant, expiresAt: "2000-01-01T00:00:00Z" };
    const writes: Write[] = [];
    const admin = makeAdmin({ "sec-1": encryptGrant(expired)! }, writes);

    const out = await resolveServerAuth(
      {
        id: "srv-1",
        user_id: "user-1",
        auth_headers_cipher: null,
        oauth_grant_cipher: null,
        oauth_grant_secret_id: "sec-1",
      },
      admin
    );

    expect(out.Authorization).toBe("Bearer rotated");
    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe("user_secrets");
    expect(writes[0].id).toBe("sec-1");
    expect(decryptGrant(writes[0].patch.value_cipher as string)!.accessToken).toBe("rotated");
  });
});
