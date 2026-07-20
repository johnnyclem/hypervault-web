import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  resolveApiIdentity: vi.fn(async () => ({ identity: { userId: "user-1", via: "api-key" } })),
}));

type Row = Record<string, unknown> | null;
const responses: { update: Row; error: { code?: string; message: string } | null } = {
  update: null,
  error: null,
};
const updatePayloads: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.update = (payload: Record<string, unknown>) => {
        updatePayloads.push({ ...payload });
        return chain;
      };
      chain.eq = () => chain;
      chain.select = () => chain;
      chain.maybeSingle = async () => ({ data: responses.update, error: responses.error });
      return chain;
    },
  }),
}));

import { PATCH } from "../route";

function patchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/dashboard-theme", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  responses.update = null;
  responses.error = null;
  updatePayloads.length = 0;
});

describe("PATCH /api/dashboard-theme", () => {
  it("restyles the owner's dashboard", async () => {
    responses.update = { theme: "vaporwave" };
    const res = await PATCH(patchRequest({ theme: "vaporwave" }));
    expect(res.status).toBe(200);
    expect((await res.json()).theme).toBe("vaporwave");
    expect(updatePayloads).toEqual([{ theme: "vaporwave" }]);
  });

  it("clears back to the stock look with theme: null", async () => {
    responses.update = { theme: null };
    const res = await PATCH(patchRequest({ theme: null }));
    expect(res.status).toBe(200);
    expect((await res.json()).theme).toBeNull();
    expect(updatePayloads).toEqual([{ theme: null }]);
  });

  it("rejects unknown theme ids", async () => {
    const res = await PATCH(patchRequest({ theme: "not-a-theme" }));
    expect(res.status).toBe(400);
    expect(updatePayloads).toHaveLength(0);
  });

  it("points at the missing migration when the theme column doesn't exist", async () => {
    responses.error = {
      code: "PGRST204",
      message: "Could not find the 'theme' column of 'profiles' in the schema cache",
    };
    const res = await PATCH(patchRequest({ theme: "vaporwave" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("0015_dashboard_theme.sql");
  });
});
