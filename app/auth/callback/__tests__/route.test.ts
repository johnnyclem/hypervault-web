import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";


type QueryResult = { data: unknown; error: { message: string } | null };

const state: {
  exchange: { data: { user: { id: string; email: string } | null }; error: { message: string } | null };
  accessResults: QueryResult[];
  isAdmin: boolean;
  signOutCalls: number;
} = {
  exchange: { data: { user: null }, error: null },
  accessResults: [],
  isAdmin: false,
  signOutCalls: 0,
};

function queryBuilder() {
  return {
    select: () => queryBuilder(),
    eq: () => queryBuilder(),
    upsert: async () => ({ data: null, error: null }),
    insert: async () => ({ data: null, error: null }),
    maybeSingle: async () => state.accessResults.shift() ?? { data: null, error: null },
  };
}

const supabaseMock = {
  auth: {
    exchangeCodeForSession: vi.fn(async () => state.exchange),
    signOut: vi.fn(async () => {
      state.signOutCalls += 1;
      return { error: null };
    }),
  },
  from: () => queryBuilder(),
  rpc: async () => ({ data: null, error: null }),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => null,
}));
vi.mock("@/lib/invites", () => ({
  INVITE_COOKIE: "hv_invite",
  isAdminEmail: () => state.isAdmin,
}));

import { GET } from "../route";

function callback(params: string, cookie?: string) {
  return GET(
    new NextRequest(`https://claudedamnit.com/auth/callback?${params}`, {
      headers: {
        host: "claudedamnit.com",
        ...(cookie ? { cookie } : {}),
      },
    })
  );
}

beforeEach(() => {
  state.exchange = { data: { user: { id: "u1", email: "u@example.com" } }, error: null };
  state.accessResults = [];
  state.isAdmin = false;
  state.signOutCalls = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /auth/callback", () => {
  it("lands an approved account on its next destination", async () => {
    state.accessResults = [{ data: { user_id: "u1" }, error: null }];
    const res = await callback(`code=abc&next=${encodeURIComponent("/a/my-thing")}`);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://claudedamnit.com/a/my-thing");
  });

  it("keeps `next` through a failed exchange so a retry still reaches the artifact", async () => {
    state.exchange = { data: { user: null }, error: { message: "invalid request" } };
    const res = await callback(`code=abc&next=${encodeURIComponent("/a/my-thing")}`);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("auth");
    expect(location.searchParams.get("next")).toBe("/a/my-thing");
  });

  it("classifies a missing PKCE verifier and sweeps auth cookies in both scopes", async () => {
    state.exchange = { data: { user: null }, error: { message: "code verifier missing" } };
    const res = await callback("code=abc", "sb-ref-auth-token=stale; theme=dark");
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("reason")).toBe("verifier");

    const setCookies = res.headers.getSetCookie().filter((c) => c.startsWith("sb-ref-auth-token=;"));
    expect(setCookies.some((c) => c.includes("Domain=.claudedamnit.com"))).toBe(true);
    expect(setCookies.some((c) => !c.includes("Domain="))).toBe(true);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("theme="))).toBe(false);
  });

  it("treats a persistent access-check error as retryable — never as 'no account'", async () => {
    const dbError = { data: null, error: { message: "connection reset" } };
    state.accessResults = [dbError, dbError];
    const res = await callback(`code=abc&intent=login&next=${encodeURIComponent("/a/x")}`);
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("retry");
    expect(location.searchParams.get("next")).toBe("/a/x");
    expect(state.signOutCalls).toBe(0);
  });

  it("recovers when the access check succeeds on its one retry", async () => {
    state.accessResults = [
      { data: null, error: { message: "transient" } },
      { data: { user_id: "u1" }, error: null },
    ];
    const res = await callback("code=abc");
    expect(res.headers.get("location")).toBe("https://claudedamnit.com/vault");
  });

  it("still bounces a genuinely unknown account on login intent, signed out", async () => {
    state.accessResults = [{ data: null, error: null }];
    const res = await callback("code=abc&intent=login");
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("no_account");
    expect(state.signOutCalls).toBe(1);
  });

  it("labels a provider bounce (no code) distinctly", async () => {
    const res = await callback("error=access_denied&error_description=cancelled");
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("auth");
    expect(location.searchParams.get("reason")).toBe("provider");
  });

  it("rejects a protocol-relative `next` instead of open-redirecting", async () => {
    state.accessResults = [{ data: { user_id: "u1" }, error: null }];
    const res = await callback(`code=abc&next=${encodeURIComponent("//evil.example")}`);
    expect(res.headers.get("location")).toBe("https://claudedamnit.com/vault");
  });
});
