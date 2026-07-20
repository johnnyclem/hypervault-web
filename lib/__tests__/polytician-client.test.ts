import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isPolyticianConfigured,
  polyticianEmbed,
  polyticianRerank,
  polyticianSidecarUrl,
} from "@/lib/polytician/client";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("polytician configuration", () => {
  it("is off when POLYTICIAN_SIDECAR_URL is unset or blank", () => {
    vi.stubEnv("POLYTICIAN_SIDECAR_URL", "");
    expect(isPolyticianConfigured()).toBe(false);
    expect(polyticianSidecarUrl()).toBeNull();
  });

  it("normalizes trailing slashes off the base URL", () => {
    vi.stubEnv("POLYTICIAN_SIDECAR_URL", "http://sidecar:8787///");
    expect(polyticianSidecarUrl()).toBe("http://sidecar:8787");
  });
});

describe("polyticianEmbed", () => {
  it("returns null without a configured sidecar — and never calls fetch", async () => {
    vi.stubEnv("POLYTICIAN_SIDECAR_URL", "");
    const spy = stubFetch(async () => Response.json({ embeddings: [] }));
    expect(await polyticianEmbed(["x"])).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("posts to /embed and returns the embeddings array", async () => {
    vi.stubEnv("POLYTICIAN_SIDECAR_URL", "http://sidecar:8787");
    const spy = stubFetch(async () => Response.json({ embeddings: [[1, 0], [0, 1]] }));
    const out = await polyticianEmbed(["a", "b"]);
    expect(out).toEqual([[1, 0], [0, 1]]);
    expect(String(spy.mock.calls[0][0])).toBe("http://sidecar:8787/embed");
  });

  it("returns null on non-200s, bad JSON, count mismatch, and network errors", async () => {
    vi.stubEnv("POLYTICIAN_SIDECAR_URL", "http://sidecar:8787");

    stubFetch(async () => new Response("nope", { status: 500 }));
    expect(await polyticianEmbed(["a"])).toBeNull();

    stubFetch(async () => new Response("not json", { status: 200 }));
    expect(await polyticianEmbed(["a"])).toBeNull();

    stubFetch(async () => Response.json({ embeddings: [[1, 0]] }));
    expect(await polyticianEmbed(["a", "b"])).toBeNull();

    stubFetch(async () => {
      throw new Error("network down");
    });
    expect(await polyticianEmbed(["a"])).toBeNull();
  });
});

describe("polyticianRerank", () => {
  it("returns null when unconfigured or the query is blank", async () => {
    vi.stubEnv("POLYTICIAN_SIDECAR_URL", "");
    expect(await polyticianRerank("q", [{ id: "1", text: "t" }])).toBeNull();

    vi.stubEnv("POLYTICIAN_SIDECAR_URL", "http://sidecar:8787");
    expect(await polyticianRerank("   ", [{ id: "1", text: "t" }])).toBeNull();
  });

  it("ranks candidates by cosine similarity to the query, best first", async () => {
    vi.stubEnv("POLYTICIAN_SIDECAR_URL", "http://sidecar:8787");
    stubFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { texts: string[] };
      expect(body.texts[0]).toBe("db choice");
      return Response.json({ embeddings: [[1, 0], [0, 1], [1, 0]] });
    });
    const rank = await polyticianRerank("db choice", [
      { id: "A", text: "unrelated" },
      { id: "B", text: "exact" },
    ]);
    expect(rank).not.toBeNull();
    expect(rank!.get("B")).toBe(0);
    expect(rank!.get("A")).toBe(1);
  });
});
