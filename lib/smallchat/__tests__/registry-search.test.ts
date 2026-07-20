import { describe, expect, it } from "vitest";
import { annotateDeadServers, parseRegistryPayload, type RegistryServer } from "@/lib/smallchat/registry-search";

describe("parseRegistryPayload", () => {
  it("keeps remote-capable servers, preferring streamable-http over sse", () => {
    const payload = {
      servers: [
        {
          server: {
            name: "io.example/fetcher",
            description: "Fetches things",
            remotes: [
              { type: "sse", url: "https://fetch.example/sse" },
              { type: "streamable-http", url: "https://fetch.example/mcp" },
            ],
          },
        },
      ],
    };
    const parsed = parseRegistryPayload(payload);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      registryId: "io.example/fetcher",
      name: "fetcher",
      url: "https://fetch.example/mcp",
      transport: "streamable-http",
    });
  });

  it("accepts flat entries and transport_type field names", () => {
    const parsed = parseRegistryPayload({
      servers: [
        {
          name: "flat-server",
          remotes: [{ transport_type: "sse", url: "https://flat.example/sse" }],
        },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].transport).toBe("sse");
  });

  it("drops stdio-only and malformed entries", () => {
    const parsed = parseRegistryPayload({
      servers: [
        { server: { name: "stdio-only", packages: [{ registry: "npm" }] } },
        { server: { remotes: [{ type: "streamable-http", url: "https://x.example" }] } },
        { server: { name: "bad-url", remotes: [{ type: "streamable-http", url: "ftp://nope" }] } },
        "junk",
        null,
      ],
    });
    expect(parsed).toEqual([]);
  });

  it("de-duplicates repeated server names, keeping the first remote-capable entry", () => {
    const parsed = parseRegistryPayload({
      servers: [
        {
          server: {
            name: "io.example/dup",
            version: "1.0.0",
            remotes: [{ type: "streamable-http", url: "https://dup.example/v1" }],
          },
        },
        {
          server: {
            name: "io.example/dup",
            version: "0.9.0",
            remotes: [{ type: "streamable-http", url: "https://dup.example/v0" }],
          },
        },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].url).toBe("https://dup.example/v1");
  });

  it("skips a stdio-only version but keeps a later remote-capable version of the same server", () => {
    const parsed = parseRegistryPayload({
      servers: [
        { server: { name: "io.example/mixed", packages: [{ registryType: "npm" }] } },
        {
          server: {
            name: "io.example/mixed",
            remotes: [{ type: "sse", url: "https://mixed.example/sse" }],
          },
        },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].url).toBe("https://mixed.example/sse");
  });

  it("drops non-active entries via registry _meta status", () => {
    const parsed = parseRegistryPayload({
      servers: [
        {
          server: {
            name: "io.example/deleted",
            remotes: [{ type: "streamable-http", url: "https://deleted.example/mcp" }],
          },
          _meta: { "io.modelcontextprotocol.registry/official": { status: "deleted" } },
        },
        {
          server: {
            name: "io.example/live",
            remotes: [{ type: "streamable-http", url: "https://live.example/mcp" }],
          },
          _meta: { "io.modelcontextprotocol.registry/official": { status: "active" } },
        },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].registryId).toBe("io.example/live");
  });

  it("tolerates junk payloads", () => {
    expect(parseRegistryPayload(null)).toEqual([]);
    expect(parseRegistryPayload("nope")).toEqual([]);
    expect(parseRegistryPayload({ servers: "nope" })).toEqual([]);
  });
});

describe("annotateDeadServers", () => {
  const server = (name: string, url: string): RegistryServer => ({
    registryId: name,
    name,
    description: "",
    url,
    transport: "streamable-http",
  });

  it("flags dead URLs and demotes them below reachable ones, preserving order within each group", () => {
    const servers = [
      server("a", "https://a.example/mcp"),
      server("dead1", "https://dead.example/one/mcp"),
      server("b", "https://b.example/mcp"),
      server("dead2", "https://dead.example/two/mcp"),
    ];
    const dead = new Set(["https://dead.example/one/mcp", "https://dead.example/two/mcp"]);
    const out = annotateDeadServers(servers, dead);
    expect(out.map((s) => s.name)).toEqual(["a", "b", "dead1", "dead2"]);
    expect(out.map((s) => Boolean(s.dead))).toEqual([false, false, true, true]);
  });

  it("matches URLs regardless of a trailing slash", () => {
    const out = annotateDeadServers([server("x", "https://x.example/mcp/")], new Set(["https://x.example/mcp"]));
    expect(out[0].dead).toBe(true);
  });

  it("leaves results untouched when nothing is dead", () => {
    const servers = [server("a", "https://a.example/mcp"), server("b", "https://b.example/mcp")];
    const out = annotateDeadServers(servers, new Set());
    expect(out.map((s) => s.name)).toEqual(["a", "b"]);
    expect(out.every((s) => !s.dead)).toBe(true);
  });
});
