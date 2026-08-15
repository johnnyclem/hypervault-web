import { afterEach, describe, expect, it, vi } from "vitest";
import { McpHttpClient, isDeadEndpointStatus, parseJsonRpcBody } from "@/lib/smallchat/jsonrpc";

describe("parseJsonRpcBody", () => {
  it("parses plain JSON bodies", () => {
    const parsed = parseJsonRpcBody('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}', "application/json");
    expect(parsed.result).toEqual({ ok: true });
  });

  it("parses SSE bodies, skipping progress notifications", () => {
    const body = [
      "event: message",
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}',
      "",
      "event: message",
      'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[]}}',
      "",
    ].join("\n");
    const parsed = parseJsonRpcBody(body, "text/event-stream");
    expect(parsed.result).toEqual({ tools: [] });
  });

  it("throws on non-JSON bodies", () => {
    expect(() => parseJsonRpcBody("<html>oops</html>", "text/html")).toThrow(/not valid JSON/);
  });
});

describe("isDeadEndpointStatus", () => {
  it("treats 404 and 410 as dead, everything else as not", () => {
    expect(isDeadEndpointStatus(404)).toBe(true);
    expect(isDeadEndpointStatus(410)).toBe(true);
    expect(isDeadEndpointStatus(401)).toBe(false);
    expect(isDeadEndpointStatus(403)).toBe(false);
    expect(isDeadEndpointStatus(500)).toBe(false);
    expect(isDeadEndpointStatus(200)).toBe(false);
  });
});

describe("McpHttpClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubServer() {
    const calls: Array<{ body: Record<string, unknown>; headers: Record<string, string> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        calls.push({ body, headers: init.headers as Record<string, string> });
        const respond = (result: unknown) =>
          new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
            status: 200,
            headers: { "content-type": "application/json", "mcp-session-id": "sess-42" },
          });
        if (body.method === "initialize") return respond({ serverInfo: { name: "fixture" } });
        if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
        if (body.method === "tools/list") return respond({ tools: [{ name: "ping", description: "pong" }] });
        if (body.method === "tools/call") return respond({ content: [{ type: "text", text: "ok" }], isError: false });
        return respond({});
      })
    );
    return calls;
  }

  it("handshakes once and echoes the session id on later calls", async () => {
    const calls = stubServer();
    const client = new McpHttpClient("http://mcp.test/mcp");
    const tools = await client.listTools();
    expect(tools).toEqual([{ name: "ping", description: "pong" }]);
    await client.callTool("ping", { x: 1 });

    const methods = calls.map((c) => c.body.method);
    expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    expect(calls[0].headers["Mcp-Session-Id"]).toBeUndefined();
    expect(calls[2].headers["Mcp-Session-Id"]).toBe("sess-42");
    expect(calls[3].headers["Mcp-Session-Id"]).toBe("sess-42");
  });

  it("passes custom auth headers through", async () => {
    const calls = stubServer();
    const client = new McpHttpClient("http://mcp.test/mcp", { Authorization: "Bearer hv_secret" });
    await client.listTools();
    expect(calls.every((c) => c.headers.Authorization === "Bearer hv_secret")).toBe(true);
  });

  it("surfaces JSON-RPC errors as readable exceptions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
        if (body.method === "initialize") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );
    const client = new McpHttpClient("http://mcp.test/mcp");
    await expect(client.listTools()).rejects.toThrow("Method not found");
  });

  it("raises McpHttpError carrying the status, with a 'no server' message for a 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Server not found", { status: 404 })));
    const client = new McpHttpClient("http://mcp.test/mcp");
    await expect(client.initialize()).rejects.toMatchObject({
      name: "McpHttpError",
      status: 404,
      message: expect.stringContaining("No MCP server found"),
    });
  });

  it("raises McpHttpError with a generic message for a non-dead status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const client = new McpHttpClient("http://mcp.test/mcp");
    await expect(client.initialize()).rejects.toMatchObject({
      name: "McpHttpError",
      status: 500,
      message: expect.stringContaining("HTTP 500"),
    });
  });

  it("requests fetch with redirect: 'error' so servers can't SSRF via a 3xx hop", async () => {
    let seenInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seenInit = init;
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );
    const client = new McpHttpClient("http://mcp.test/mcp");
    await client.initialize();
    expect(seenInit?.redirect).toBe("error");
  });

  it("surfaces a redirect attempt as a normal reachability error, not a crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    const client = new McpHttpClient("http://mcp.test/mcp");
    await expect(client.initialize()).rejects.toThrow(/Could not reach/);
  });

  it("raises McpAuthError with the challenge on a 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: {
            "content-type": "application/json",
            "www-authenticate": 'Bearer resource_metadata="https://mcp.test/.well-known/oauth-protected-resource"',
          },
        })
      )
    );
    const client = new McpHttpClient("http://mcp.test/mcp");
    await expect(client.initialize()).rejects.toMatchObject({
      name: "McpAuthError",
      status: 401,
      wwwAuthenticate: expect.stringContaining("resource_metadata"),
    });
  });
});
