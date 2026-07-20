import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  resolveApiIdentity: vi.fn(async () => ({ identity: { userId: "user-1", via: "api-key" } })),
}));
vi.mock("@/lib/connections", () => ({
  syncConnectionsForArtifact: vi.fn(async () => ({ manual: 0, auto: 0 })),
}));

const insertResponses: Array<{ data: { id: string } | null; error: { message: string } | null }> = [];
const insertedPayloads: Array<Record<string, unknown>> = [];

function emptyQueryChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: null });
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: [] });
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      ...emptyQueryChain(),
      insert: (payload: Record<string, unknown>) => {
        insertedPayloads.push({ ...payload });
        return {
          select: () => ({
            single: async () => insertResponses.shift() ?? { data: null, error: { message: "queue empty" } },
          }),
        };
      },
    }),
  }),
}));

import { POST } from "../route";

function saveRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/save", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  insertResponses.length = 0;
  insertedPayloads.length = 0;
});

describe("POST /api/save schema-drift resilience", () => {
  it("saves normally when the insert succeeds first try", async () => {
    insertResponses.push({ data: { id: "a-1" }, error: null });
    const res = await POST(saveRequest({ content: "<h1>hello</h1>", title: "Hi", force_html: true }));
    expect(res.status).toBe(200);
    expect(insertedPayloads).toHaveLength(1);
    expect(insertedPayloads[0]).toHaveProperty("content_hash");
  });

  it("retries without a column the live schema is missing (unapplied migration)", async () => {
    insertResponses.push(
      { data: null, error: { message: "Could not find the 'content_hash' column of 'artifacts' in the schema cache" } },
      { data: { id: "a-2" }, error: null }
    );
    const res = await POST(saveRequest({ content: "<h1>hello</h1>", title: "Hi", force_html: true }));
    expect(res.status).toBe(200);
    expect(insertedPayloads).toHaveLength(2);
    expect(insertedPayloads[1]).not.toHaveProperty("content_hash");
    expect(insertedPayloads[1]).toHaveProperty("content");
  });

  it("still fails loudly when an essential column is reported missing", async () => {
    insertResponses.push({
      data: null,
      error: { message: "Could not find the 'content' column of 'artifacts' in the schema cache" },
    });
    const res = await POST(saveRequest({ content: "<h1>hello</h1>", title: "Hi", force_html: true }));
    expect(res.status).toBe(500);
    expect(insertedPayloads).toHaveLength(1);
  });

  it("gives up after unrelated insert errors instead of looping", async () => {
    insertResponses.push({ data: null, error: { message: "duplicate key value violates unique constraint" } });
    const res = await POST(saveRequest({ content: "<h1>hello</h1>", title: "Hi", force_html: true }));
    expect(res.status).toBe(500);
    expect(insertedPayloads).toHaveLength(1);
  });
});
