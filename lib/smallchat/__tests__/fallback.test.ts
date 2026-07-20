import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dispatchExact,
  humanizeToolName,
  lexicalResolve,
  listToolkitTools,
} from "@/lib/smallchat/fallback";
import { toProviderManifest } from "@/lib/smallchat/introspect";
import { hydrateToolkit, type StoredToolkit } from "@/lib/smallchat/runtime";
import { ToolCompiler } from "@/lib/vendor/smallchat/compiler/compiler";
import { LocalEmbedder } from "@/lib/vendor/smallchat/embedding/local-embedder";
import { MemoryVectorIndex } from "@/lib/vendor/smallchat/embedding/memory-vector-index";
import { buildArtifact } from "@/lib/vendor/smallchat/mcp/artifact";
import type { ToolRuntime } from "@/lib/vendor/smallchat/runtime/runtime";

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

let toolkitSeq = 0;
async function hydrateFixture(): Promise<ToolRuntime> {
  const manifest = toProviderManifest(
    { id: "srv-1", name: "Tasks", url: "http://mcp.test/mcp" },
    [
      { name: "list_tasks", description: "list all tasks in the vault", input_schema: { type: "object" } },
      { name: "bulk_update_tasks", description: "update many tasks at once", input_schema: { type: "object" } },
      { name: "list_reminders", description: "list reminders", input_schema: { type: "object" } },
    ],
    []
  );
  const embedder = new LocalEmbedder();
  const compiler = new ToolCompiler(embedder, new MemoryVectorIndex(), { compileApps: false });
  const result = await compiler.compile([manifest]);
  const artifact = buildArtifact(result, [manifest]);
  const toolkit: StoredToolkit = {
    id: `tk-${++toolkitSeq}`,
    artifact,
    header: "### Tasks",
    embedder: { kind: "local", dimensions: embedder.dimensions },
    endpoints: { "srv-1": { url: "http://mcp.test/mcp", name: "Tasks", headers_cipher: null } },
  };
  const hydrated = await hydrateToolkit(emptyAdmin(), "user-1", toolkit);
  if (!hydrated.ok) throw new Error("fixture failed to hydrate");
  return hydrated.runtime;
}

describe("hydrateToolkit embedder identity", () => {
  it("reports the active embedder on a successful hydrate", async () => {
    const manifest = toProviderManifest(
      { id: "srv-1", name: "Tasks", url: "http://mcp.test/mcp" },
      [{ name: "list_tasks", description: "list all tasks", input_schema: { type: "object" } }],
      []
    );
    const embedder = new LocalEmbedder();
    const compiler = new ToolCompiler(embedder, new MemoryVectorIndex(), { compileApps: false });
    const artifact = buildArtifact(await compiler.compile([manifest]), [manifest]);
    const toolkit: StoredToolkit = {
      id: `tk-embid-${++toolkitSeq}`,
      artifact,
      header: "### Tasks",
      embedder: { kind: "local", dimensions: embedder.dimensions },
      endpoints: { "srv-1": { url: "http://mcp.test/mcp", name: "Tasks", headers_cipher: null } },
    };
    const hydrated = await hydrateToolkit(emptyAdmin(), "user-1", toolkit);
    expect(hydrated.ok).toBe(true);
    if (hydrated.ok) expect(hydrated.embedder.kind).toBe("local");
  });
});

describe("humanizeToolName", () => {
  it("drops the provider prefix and title-cases the tool", () => {
    expect(humanizeToolName("77505f39-e60f-48e7-be24-1e85b4b1b449.list_tasks")).toBe("List Tasks");
    expect(humanizeToolName("srv-1.bulk_update_tasks")).toBe("Bulk Update Tasks");
  });
});

describe("listToolkitTools", () => {
  it("lists every tool with a clean label and its canonical id", async () => {
    const runtime = await hydrateFixture();
    const tools = listToolkitTools(runtime);
    const byName = Object.fromEntries(tools.map((t) => [t.toolName, t]));
    expect(byName.list_tasks.canonical).toBe("srv-1.list_tasks");
    expect(byName.list_tasks.label).toBe("List Tasks");
    expect(byName.list_tasks.providerId).toBe("srv-1");
    expect(tools.every((t) => !/\b[0-9a-f-]{20,}/.test(t.label))).toBe(true);
  });
});

describe("lexicalResolve", () => {
  it("resolves an intent that literally names one tool (filler ignored)", async () => {
    const runtime = await hydrateFixture();
    const res = lexicalResolve(runtime, "list all tasks");
    expect(res).toEqual({ kind: "resolved", canonical: "srv-1.list_tasks", toolName: "list_tasks" });
  });

  it("declines when nothing is plainly named", async () => {
    const runtime = await hydrateFixture();
    expect(lexicalResolve(runtime, "what should I do today").kind).toBe("none");
  });

  it("stays ambiguous when several tools are equally named", async () => {
    const runtime = await hydrateFixture();
    const res = lexicalResolve(runtime, "list tasks and reminders");
    expect(res.kind).toBe("ambiguous");
    if (res.kind === "ambiguous") {
      expect(res.canonicals).toContain("srv-1.list_tasks");
      expect(res.canonicals).toContain("srv-1.list_reminders");
    }
  });

  it("ignores intent selectors the dispatcher interned into the shared table", async () => {
    const runtime = await hydrateFixture();
    const toolsBefore = listToolkitTools(runtime).map((t) => t.canonical).sort();
    await runtime.selectorTable.resolve("search tasks now");
    const toolsAfter = listToolkitTools(runtime).map((t) => t.canonical).sort();
    expect(toolsAfter).toEqual(toolsBefore);
    expect(toolsAfter).not.toContain("search:tasks:now");

    const res = lexicalResolve(runtime, "search tasks now");
    if (res.kind === "resolved") expect(res.canonical).not.toContain(":");
  });
});

describe("dispatchExact", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs a tool by canonical id, hitting the live endpoint without re-embedding", async () => {
    const runtime = await hydrateFixture();
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        calls.push(body);
        if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
        const result =
          body.method === "tools/call"
            ? { content: [{ type: "text", text: "3 tasks" }], isError: false }
            : { serverInfo: { name: "Tasks" } };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );

    const result = await dispatchExact(runtime, "srv-1.list_tasks", {});
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).toContain("3 tasks");
    const call = calls.find((c) => c.method === "tools/call");
    expect((call!.params as Record<string, unknown>).name).toBe("list_tasks");
  });

  it("returns a readable error for a canonical that is no longer in the toolkit", async () => {
    const runtime = await hydrateFixture();
    const result = await dispatchExact(runtime, "srv-1.deleted_tool", {});
    expect(result.isError).toBe(true);
    expect(String(result.content)).toContain("no longer in the toolkit");
  });
});
