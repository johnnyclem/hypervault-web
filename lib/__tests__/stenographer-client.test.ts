import { afterEach, describe, expect, it, vi } from "vitest";
import { isStenographerConfigured, stenographerRecall, stenographerUrl } from "@/lib/stenographer/client";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubFetch(impl: (input: RequestInfo | URL) => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("stenographer configuration", () => {
  it("is off when STENOGRAPHER_URL is unset or blank", () => {
    vi.stubEnv("STENOGRAPHER_URL", "");
    expect(isStenographerConfigured()).toBe(false);
    expect(stenographerUrl()).toBeNull();
  });

  it("normalizes trailing slashes off the base URL", () => {
    vi.stubEnv("STENOGRAPHER_URL", "http://sidecar:8787///");
    expect(stenographerUrl()).toBe("http://sidecar:8787");
  });
});

describe("stenographerRecall", () => {
  it("returns null without a configured sidecar — and never calls fetch", async () => {
    vi.stubEnv("STENOGRAPHER_URL", "");
    const spy = stubFetch(async () => new Response("[]"));
    expect(await stenographerRecall("what did we decide?")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("renders GraphRAG chunks into a labeled system block", async () => {
    vi.stubEnv("STENOGRAPHER_URL", "http://sidecar:8787");
    const spy = stubFetch(async () =>
      Response.json([
        { id: "1", content: "We chose Postgres over Mongo.", score: 0.9, type: "decision" },
        { id: "2", content: "Postgres", score: 0.8, type: "entity" },
      ])
    );
    const result = await stenographerRecall("database choice");
    expect(result).not.toBeNull();
    expect(result!.contextBlock).toContain("## Long-horizon memory (conversation graph)");
    expect(result!.contextBlock).toContain("[decision] We chose Postgres over Mongo.");
    expect(result!.labels[0]).toContain("decision");
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("http://sidecar:8787/graphrag?q=database%20choice");
  });

  it("returns null on empty results, non-200s, bad JSON, and network errors", async () => {
    vi.stubEnv("STENOGRAPHER_URL", "http://sidecar:8787");

    stubFetch(async () => Response.json([]));
    expect(await stenographerRecall("anything")).toBeNull();

    stubFetch(async () => new Response("nope", { status: 500 }));
    expect(await stenographerRecall("anything")).toBeNull();

    stubFetch(async () => new Response("not json"));
    expect(await stenographerRecall("anything")).toBeNull();

    stubFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await stenographerRecall("anything")).toBeNull();
  });

  it("skips blank queries", async () => {
    vi.stubEnv("STENOGRAPHER_URL", "http://sidecar:8787");
    const spy = stubFetch(async () => Response.json([]));
    expect(await stenographerRecall("   ")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
