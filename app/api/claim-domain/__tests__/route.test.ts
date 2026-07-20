import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  resolveApiIdentity: vi.fn(async () => ({ identity: { userId: "user-1", via: "api-key" } })),
}));

type Row = Record<string, unknown> | null;
type Err = { code?: string; message: string } | null;
const responses: { update: Row; profile: Row; insert: Row; updateError: Err } = {
  update: null,
  profile: null,
  insert: null,
  updateError: null,
};
const insertedPayloads: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      let result: () => Row = () => null;
      let error: () => Err = () => null;
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.update = () => {
        result = () => responses.update;
        error = () => responses.updateError;
        return chain;
      };
      chain.insert = (payload: Record<string, unknown>) => {
        insertedPayloads.push({ ...payload });
        result = () => responses.insert;
        return chain;
      };
      if (table === "profiles") result = () => responses.profile;
      chain.maybeSingle = async () => ({ data: result(), error: error() });
      return chain;
    },
  }),
}));

import { PATCH } from "../route";

function patchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/claim-domain", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  responses.update = null;
  responses.profile = null;
  responses.insert = null;
  responses.updateError = null;
  insertedPayloads.length = 0;
});

describe("PATCH /api/claim-domain", () => {
  it("restyles an existing claim", async () => {
    responses.update = { subdomain: "nova", base_domain: "vault.cool", theme: "art-deco" };
    const res = await PATCH(patchRequest({ subdomain: "nova", base_domain: "vault.cool", theme: "art-deco" }));
    expect(res.status).toBe(200);
    expect((await res.json()).theme).toBe("art-deco");
    expect(insertedPayloads).toHaveLength(0);
  });

  it("self-heals a legacy vanity realm that has no claim row", async () => {
    responses.profile = { vanity_subdomain: "nova" };
    responses.insert = { subdomain: "nova", base_domain: "vault.cool", theme: "art-deco" };
    const res = await PATCH(patchRequest({ subdomain: "nova", base_domain: "vault.cool", theme: "art-deco" }));
    expect(res.status).toBe(200);
    expect((await res.json()).theme).toBe("art-deco");
    expect(insertedPayloads).toEqual([
      { user_id: "user-1", subdomain: "nova", base_domain: "vault.cool", theme: "art-deco" },
    ]);
  });

  it("404s for a realm the user never claimed", async () => {
    responses.profile = { vanity_subdomain: "someone-else" };
    const res = await PATCH(patchRequest({ subdomain: "nova", base_domain: "vault.cool", theme: "art-deco" }));
    expect(res.status).toBe(404);
    expect(insertedPayloads).toHaveLength(0);
  });

  it("only self-heals on vault.cool — legacy vanity realms never lived elsewhere", async () => {
    responses.profile = { vanity_subdomain: "nova" };
    const res = await PATCH(patchRequest({ subdomain: "nova", base_domain: "claudedamnit.com", theme: "art-deco" }));
    expect(res.status).toBe(404);
    expect(insertedPayloads).toHaveLength(0);
  });

  it("rejects unknown theme ids", async () => {
    const res = await PATCH(patchRequest({ subdomain: "nova", base_domain: "vault.cool", theme: "not-a-theme" }));
    expect(res.status).toBe(400);
  });

  it("points at the missing migration when the theme column doesn't exist", async () => {
    responses.updateError = {
      code: "PGRST204",
      message: "Could not find the 'theme' column of 'domain_claims' in the schema cache",
    };
    const res = await PATCH(patchRequest({ subdomain: "nova", base_domain: "vault.cool", theme: "art-deco" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("0015_dashboard_theme.sql");
  });
});
