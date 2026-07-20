import { afterEach, describe, expect, it, vi } from "vitest";
import { probeLiveness } from "@/lib/smallchat/liveness";

function stubStatus(status: number, body: string, headers: Record<string, string> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status, headers: { "content-type": "text/plain", ...headers } }))
  );
}

describe("probeLiveness", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports alive when the handshake succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { id?: number; method?: string };
        if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { serverInfo: { name: "x" } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );
    expect(await probeLiveness("https://ok.example/mcp")).toEqual({ url: "https://ok.example/mcp", state: "alive" });
  });

  it("reports dead on 404 (no server here)", async () => {
    stubStatus(404, "Server not found");
    expect(await probeLiveness("https://gone.example/mcp")).toMatchObject({ state: "dead", status: 404 });
  });

  it("reports dead on 410", async () => {
    stubStatus(410, "Gone");
    expect(await probeLiveness("https://gone.example/mcp")).toMatchObject({ state: "dead", status: 410 });
  });

  it("treats an auth challenge as alive — the server exists, it just needs credentials", async () => {
    stubStatus(401, '{"error":"unauthorized"}', {
      "www-authenticate": 'Bearer resource_metadata="https://x.example/.well-known/oauth-protected-resource"',
    });
    expect(await probeLiveness("https://gated.example/mcp")).toMatchObject({ state: "alive", status: 401 });
  });

  it("reports unknown on a transient 5xx (not demoted)", async () => {
    stubStatus(503, "temporarily down");
    expect(await probeLiveness("https://flaky.example/mcp")).toMatchObject({ state: "unknown", status: 503 });
  });

  it("reports unknown on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    expect(await probeLiveness("https://unreachable.example/mcp")).toEqual({
      url: "https://unreachable.example/mcp",
      state: "unknown",
    });
  });
});
