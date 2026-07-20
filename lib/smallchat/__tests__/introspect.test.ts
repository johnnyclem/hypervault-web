import { describe, expect, it } from "vitest";
import { toProviderManifest } from "@/lib/smallchat/introspect";

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
