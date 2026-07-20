import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  resolveApiIdentity: vi.fn(async () => ({ identity: { userId: "user-1", via: "api-key" } })),
}));

type Row = Record<string, unknown> | null;
const responses: { row: Row; error: { code?: string; message: string } | null } = {
  row: null,
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
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({ data: responses.row, error: responses.error });
      return chain;
    },
  }),
}));

import { GET, PATCH } from "../route";

function patchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/chat-settings", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  responses.row = null;
  responses.error = null;
  updatePayloads.length = 0;
});

describe("GET /api/chat-settings", () => {
  it("returns the persisted toggles", async () => {
    responses.row = { chat_smart_context: false, chat_deep_memory: true };
    const res = await GET(new NextRequest("http://localhost/api/chat-settings"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ smart_context: false, deep_memory: true, polytician: true });
  });

  it("defaults both ON for a pre-0017 database instead of erroring", async () => {
    responses.error = {
      code: "42703",
      message: "column profiles.chat_smart_context does not exist",
    };
    const res = await GET(new NextRequest("http://localhost/api/chat-settings"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ smart_context: true, deep_memory: true, polytician: true });
  });
});

describe("PATCH /api/chat-settings", () => {
  it("persists a toggle and echoes both values", async () => {
    responses.row = { chat_smart_context: false, chat_deep_memory: true };
    const res = await PATCH(patchRequest({ smart_context: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ smart_context: false, deep_memory: true, polytician: true });
    expect(updatePayloads).toEqual([{ chat_smart_context: false }]);
  });

  it("accepts both toggles in one request", async () => {
    responses.row = { chat_smart_context: true, chat_deep_memory: false };
    const res = await PATCH(patchRequest({ smart_context: true, deep_memory: false }));
    expect(res.status).toBe(200);
    expect(updatePayloads).toEqual([{ chat_smart_context: true, chat_deep_memory: false }]);
  });

  it("rejects non-boolean values", async () => {
    const res = await PATCH(patchRequest({ smart_context: "yes" }));
    expect(res.status).toBe(400);
    expect(updatePayloads).toHaveLength(0);
  });

  it("rejects an empty patch", async () => {
    const res = await PATCH(patchRequest({}));
    expect(res.status).toBe(400);
    expect(updatePayloads).toHaveLength(0);
  });

  it("points at migration 0017 when the columns don't exist", async () => {
    responses.error = {
      code: "PGRST204",
      message: "Could not find the 'chat_smart_context' column of 'profiles' in the schema cache",
    };
    const res = await PATCH(patchRequest({ smart_context: false }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("0017_chat_context_settings.sql");
  });
});
