import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

beforeAll(() => {
  process.env.HYPERVAULT_KEY_SECRET = "test-secret-for-secrets-route";
});

const state: {
  identity: { userId: string; via: string; keyId?: string } | { error: string; status: number };
  secret: { id: string; name: string; kind: string; value_cipher: string; user_id: string } | null;
  grantedKeyId: string | null;
  stamped: boolean;
} = { identity: { userId: "u1", via: "api-key", keyId: "key-1" }, secret: null, grantedKeyId: null, stamped: false };

vi.mock("@/lib/api-auth", () => ({
  resolveApiIdentity: vi.fn(async () =>
    "error" in state.identity ? state.identity : { identity: state.identity }
  ),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
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
            state.stamped = true;
            return Promise.resolve({ error: null });
          }
          return builder;
        },
        async maybeSingle() {
          if (table === "user_secrets") {
            const s = state.secret;
            const match = s && s.user_id === filters.user_id && s.name === filters.name;
            return { data: match ? s : null, error: null };
          }
          if (table === "secret_grants") {
            const ok = state.grantedKeyId && filters.api_key_id === state.grantedKeyId;
            return { data: ok ? { id: "grant-1" } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return builder;
    },
  }),
}));

import { encryptSecret } from "@/lib/backends/crypto";
import { GET } from "../route";

function get(name: string) {
  return GET(new NextRequest(`https://hv.test/api/secrets/${name}`), {
    params: Promise.resolve({ name }),
  });
}

beforeEach(() => {
  state.identity = { userId: "u1", via: "api-key", keyId: "key-1" };
  state.secret = {
    id: "sec-1",
    name: "gh-token",
    kind: "opaque",
    value_cipher: encryptSecret("ghp_secret")!,
    user_id: "u1",
  };
  state.grantedKeyId = null;
  state.stamped = false;
});

describe("GET /api/secrets/[name] — grant-gated AgentVault read", () => {
  it("returns the value to a granted API key and stamps usage", async () => {
    state.grantedKeyId = "key-1";
    const res = await get("gh-token");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.value).toBe("ghp_secret");
    expect(body.name).toBe("gh-token");
    expect(state.stamped).toBe(true);
  });

  it("404s an ungranted key without revealing the secret exists", async () => {
    state.grantedKeyId = null;
    const res = await get("gh-token");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("NOT_FOUND");
    expect(body.value).toBeUndefined();
  });

  it("404s for a name that has no secret (same shape as ungranted)", async () => {
    state.grantedKeyId = "key-1";
    const res = await get("does-not-exist");
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
  });

  it("forbids a session identity from reading raw values", async () => {
    state.identity = { userId: "u1", via: "session" };
    state.grantedKeyId = "key-1";
    const res = await get("gh-token");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("FORBIDDEN");
  });

  it("passes through an auth failure from resolveApiIdentity", async () => {
    state.identity = { error: "Invalid or revoked HyperVault API key.", status: 401 };
    const res = await get("gh-token");
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("UNAUTHORIZED");
  });
});
