import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  user: { id: string; email?: string } | null;
  data: Record<string, unknown> | null;
  error: { message: string } | null;
} = {
  user: null,
  data: null,
  error: null,
};

function fakeClient() {
  return {
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({ data: state.data, error: state.error });
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fakeClient(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeClient(),
  getUser: async () => state.user,
}));

import { getAccess } from "@/lib/access";

beforeEach(() => {
  state.user = { id: "user-1", email: "someone@example.com" };
  state.data = null;
  state.error = null;
  vi.stubEnv("HYPERVAULT_ADMIN_EMAILS", "");
});

describe("getAccess", () => {
  it("denies access when there is no signed-in user", async () => {
    state.user = null;
    expect(await getAccess()).toEqual({ user: null, approved: false, isAdmin: false });
  });

  it("approves when an account_access row exists", async () => {
    state.data = { user_id: "user-1" };
    const access = await getAccess();
    expect(access.approved).toBe(true);
  });

  it("denies when no account_access row exists", async () => {
    state.data = null;
    state.error = null;
    const access = await getAccess();
    expect(access.approved).toBe(false);
  });

  it("fails closed (does not grant access) when the account_access check errors persistently", async () => {
    state.data = null;
    state.error = { message: "connection reset" };
    const access = await getAccess();
    expect(access.approved).toBe(false);
  });

  it("always approves admin emails regardless of account_access", async () => {
    vi.stubEnv("HYPERVAULT_ADMIN_EMAILS", "someone@example.com");
    state.error = { message: "connection reset" };
    const access = await getAccess();
    expect(access).toEqual({ user: state.user, approved: true, isAdmin: true });
  });
});
