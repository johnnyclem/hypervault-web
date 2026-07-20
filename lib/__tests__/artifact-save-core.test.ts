import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/connections", () => ({ syncConnectionsForArtifact: vi.fn(async () => ({ manual: 0, auto: 0 })) }));
vi.mock("@/lib/memory", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, syncMemoryLinksForArtifact: vi.fn(async () => 0) };
});
vi.mock("@/lib/utils", () => ({ appUrl: () => "https://hypervault.store" }));

import { saveArtifactCore } from "@/lib/artifacts/save";

const insertResponses: Array<{ data: { id: string } | null; error: { message: string } | null }> = [];
const insertedPayloads: Array<Record<string, unknown>> = [];

function emptyQueryChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: null });
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: [] });
  return chain;
}

const admin = {
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
} as unknown as Parameters<typeof saveArtifactCore>[0];

beforeEach(() => {
  insertResponses.length = 0;
  insertedPayloads.length = 0;
});

describe("saveArtifactCore", () => {
  it("inserts and returns a permanent URL on first try", async () => {
    insertResponses.push({ data: { id: "a-1" }, error: null });
    const res = await saveArtifactCore(admin, "user-1", {
      storedContent: "<h1>hi</h1>", title: "Hi", type: "html", visibility: "private",
    });
    expect(res).not.toHaveProperty("error");
    if ("error" in res) throw new Error("unexpected error");
    expect(res.duplicate).toBe(false);
    expect(res.slug).toBeTruthy();
    expect(res.url).toBe(`https://hypervault.store/a/${res.slug}`);
    expect(insertedPayloads[0]).toHaveProperty("content_hash");
  });

  it("retries shedding a column the live schema is missing", async () => {
    insertResponses.push(
      { data: null, error: { message: "Could not find the 'content_hash' column of 'artifacts' in the schema cache" } },
      { data: { id: "a-2" }, error: null }
    );
    const res = await saveArtifactCore(admin, "user-1", {
      storedContent: "<h1>hi</h1>", title: "Hi", type: "html", visibility: "private",
    });
    expect("error" in res).toBe(false);
    expect(insertedPayloads).toHaveLength(2);
    expect(insertedPayloads[1]).not.toHaveProperty("content_hash");
    expect(insertedPayloads[1]).toHaveProperty("content");
  });

  it("fails when an essential column is reported missing", async () => {
    insertResponses.push({
      data: null,
      error: { message: "Could not find the 'content' column of 'artifacts' in the schema cache" },
    });
    const res = await saveArtifactCore(admin, "user-1", {
      storedContent: "<h1>hi</h1>", title: "Hi", type: "html", visibility: "private",
    });
    expect("error" in res && res.status).toBe(500);
    expect(insertedPayloads).toHaveLength(1);
  });
});
