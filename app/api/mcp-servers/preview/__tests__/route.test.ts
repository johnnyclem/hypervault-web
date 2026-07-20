import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { IntrospectResult } from "@/lib/smallchat/introspect";

vi.mock("@/lib/api-auth", () => ({
  resolveApiIdentity: vi.fn(async () => ({ identity: { userId: "user-1", via: "api-key" } })),
}));

const probe: { result: IntrospectResult; calls: Array<[string, Record<string, string> | undefined]> } = {
  result: { ok: true, serverName: "Fixture", tools: [] },
  calls: [],
};

vi.mock("@/lib/smallchat/introspect", () => ({
  introspectMcpServer: vi.fn(async (url: string, headers?: Record<string, string>) => {
    probe.calls.push([url, headers]);
    return probe.result;
  }),
}));

const marked: Array<[string, number]> = [];
vi.mock("@/lib/smallchat/dead-endpoints", () => ({
  markDeadEndpoint: vi.fn(async (url: string, status: number) => {
    marked.push([url, status]);
  }),
}));

import { POST } from "../route";

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/mcp-servers/preview", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  probe.result = { ok: true, serverName: "Fixture", tools: [] };
  probe.calls.length = 0;
  marked.length = 0;
});

describe("POST /api/mcp-servers/preview", () => {
  it("returns the tool inventory without persisting", async () => {
    probe.result = {
      ok: true,
      serverName: "Thinker",
      tools: [{ name: "think", description: "Reason step by step", input_schema: { type: "object" } }],
    };
    const res = await POST(req({ url: "https://mcp.example.com/mcp/" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toBe("https://mcp.example.com/mcp");
    expect(data.name).toBe("Thinker");
    expect(data.tools).toHaveLength(1);
    expect(data.tools[0].name).toBe("think");
  });

  it("passes auth headers through to the probe but never echoes them back", async () => {
    const res = await POST(req({ url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer x" } }));
    expect(res.status).toBe(200);
    expect(probe.calls[0][1]).toEqual({ Authorization: "Bearer x" });
    const data = await res.json();
    expect(JSON.stringify(data)).not.toContain("Bearer x");
  });

  it("prefers an explicit name over the server-reported one", async () => {
    const res = await POST(req({ url: "https://mcp.example.com/mcp", name: "  My Server  " }));
    expect((await res.json()).name).toBe("My Server");
  });

  it("rejects a non-http URL", async () => {
    const res = await POST(req({ url: "ftp://nope" }));
    expect(res.status).toBe(400);
    expect(probe.calls).toHaveLength(0);
  });

  it("rejects a non-JSON body", async () => {
    const res = await POST(req("not json"));
    expect(res.status).toBe(400);
  });

  it("surfaces an introspection failure as 502", async () => {
    probe.result = { ok: false, error: "connection refused" };
    const res = await POST(req({ url: "https://mcp.example.com/mcp" }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("connection refused");
    expect(marked).toHaveLength(0);
  });

  it("remembers a dead endpoint (404) and flags it back to the client", async () => {
    probe.result = { ok: false, error: "No MCP server found at this URL (HTTP 404).", status: 404, dead: true };
    const res = await POST(req({ url: "https://gone.example/mcp" }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.dead).toBe(true);
    expect(data.status).toBe(404);
    expect(marked).toEqual([["https://gone.example/mcp", 404]]);
  });

  it("does not persist a dead verdict when the probe used private auth headers", async () => {
    probe.result = { ok: false, error: "No MCP server found at this URL (HTTP 404).", status: 404, dead: true };
    const res = await POST(req({ url: "https://gone.example/mcp", headers: { Authorization: "Bearer x" } }));
    const data = await res.json();
    expect(data.dead).toBe(true);
    expect(marked).toHaveLength(0);
  });
});
