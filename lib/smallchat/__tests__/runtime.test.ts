import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toProviderManifest } from "@/lib/smallchat/introspect";
import { hydrateToolkit, type StoredToolkit } from "@/lib/smallchat/runtime";
import { ToolCompiler } from "@/lib/vendor/smallchat/compiler/compiler";
import { LocalEmbedder } from "@/lib/vendor/smallchat/embedding/local-embedder";
import { MemoryVectorIndex } from "@/lib/vendor/smallchat/embedding/memory-vector-index";
import { buildArtifact } from "@/lib/vendor/smallchat/mcp/artifact";

function emptyAdmin(): SupabaseClient {
  const chain: Record<string, unknown> = {};
  const resolve = Promise.resolve({ data: [], error: null });
  for (const m of ["select", "eq", "order", "limit", "gt", "maybeSingle", "single", "update", "insert", "delete", "in"]) {
    chain[m] = () => chain;
  }
  chain.then = resolve.then.bind(resolve);
  chain.catch = resolve.catch.bind(resolve);
  chain.finally = resolve.finally.bind(resolve);
  return { from: () => chain } as unknown as SupabaseClient;
}

async function compileFixtureToolkit(): Promise<StoredToolkit> {
  const manifest = toProviderManifest(
    { id: "srv-1", name: "Fixture", url: "http://mcp.test/mcp" },
    [
      { name: "send_message", description: "send a chat message", input_schema: { type: "object" } },
      { name: "list_items", description: "list vault items", input_schema: { type: "object" } },
    ],
    []
  );
  const embedder = new LocalEmbedder();
  const compiler = new ToolCompiler(embedder, new MemoryVectorIndex(), { compileApps: false });
  const result = await compiler.compile([manifest]);
  const artifact = buildArtifact(result, [manifest]);
  return {
    id: "tk-1",
    artifact,
    header: "### Fixture\n- send a chat message",
    embedder: { kind: "local", dimensions: embedder.dimensions },
    endpoints: { "srv-1": { url: "http://mcp.test/mcp", name: "Fixture", headers_cipher: null } },
  };
}

describe("hydrateToolkit + dispatch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hydrates a stored artifact and dispatches an intent to the live endpoint", async () => {
    const toolkit = await compileFixtureToolkit();

    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        calls.push(body);
        if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
        const result =
          body.method === "tools/call"
            ? { content: [{ type: "text", text: "delivered" }], isError: false }
            : { serverInfo: { name: "Fixture" } };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );

    const hydrated = await hydrateToolkit(emptyAdmin(), "user-1", toolkit);
    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) return;

    const result = await hydrated.runtime.dispatch("send_message: send a chat message", { text: "hi" });
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).toContain("delivered");

    const call = calls.find((c) => c.method === "tools/call");
    expect(call).toBeDefined();
    expect((call!.params as Record<string, unknown>).name).toBe("send_message");
  });

  it("refuses to hydrate when the embedder identity no longer matches", async () => {
    const toolkit = await compileFixtureToolkit();
    toolkit.id = "tk-2";
    toolkit.embedder = { kind: "api", model: "text-embedding-3-small", dimensions: 1536 };
    const hydrated = await hydrateToolkit(emptyAdmin(), "user-1", toolkit);
    expect(hydrated).toMatchObject({ ok: false, reason: "embedder_mismatch" });
  });
});
