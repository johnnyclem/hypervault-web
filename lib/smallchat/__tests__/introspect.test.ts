import { describe, expect, it } from "vitest";
import { introspectMcpServer, toProviderManifest } from "@/lib/smallchat/introspect";

const server = { id: "srv-1", name: "Fixture", url: "http://mcp.test/mcp" };
const tools = [
  { name: "alpha", description: "does alpha", input_schema: { type: "object", properties: { a: {} } } },
  { name: "beta", description: "", input_schema: { type: "object" } },
];

describe("toProviderManifest", () => {
  it("maps rows into a smallchat ProviderManifest", () => {
    const manifest = toProviderManifest(server, tools, []);
    expect(manifest.id).toBe("srv-1");
    expect(manifest.transportType).toBe("mcp");
    expect(manifest.endpoint).toBe("http://mcp.test/mcp");
    expect(manifest.tools).toHaveLength(2);
    expect(manifest.tools[0]).toMatchObject({
      name: "alpha",
      description: "does alpha",
      providerId: "srv-1",
      transportType: "mcp",
    });
    expect(manifest.tools[1].description).toBe("beta");
  });

  it("filters disabled tools out before the compiler sees them", () => {
    const manifest = toProviderManifest(server, tools, ["alpha"]);
    expect(manifest.tools.map((t) => t.name)).toEqual(["beta"]);
  });
});

describe("introspectMcpServer SSRF guard", () => {
  it("rejects loopback URLs without making a network call", async () => {
    const result = await introspectMcpServer("http://127.0.0.1:8080/mcp");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/private or local/);
  });

  it("rejects link-local metadata addresses", async () => {
    const result = await introspectMcpServer("http://169.254.169.254/latest/meta-data");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/private or local/);
  });

  it("rejects localhost and .internal hostnames", async () => {
    for (const url of ["http://localhost/mcp", "http://service.internal/mcp"]) {
      const result = await introspectMcpServer(url);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/private or local/);
    }
  });

  it("rejects non-http(s) protocols", async () => {
    const result = await introspectMcpServer("file:///etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Only http\(s\)/);
  });

  it("rejects malformed URLs", async () => {
    const result = await introspectMcpServer("not-a-url");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/valid URL/);
  });
});
