import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/connections", () => ({ syncConnectionsForArtifact: vi.fn(async () => ({ manual: 0, auto: 0 })) }));
vi.mock("@/lib/memory", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, syncMemoryLinksForArtifact: vi.fn(async () => 0) };
});
vi.mock("@/lib/utils", () => ({ appUrl: () => "https://hypervault.store" }));

import { saveArtifactCore } from "@/lib/artifacts/save";
import { contentHash } from "@/lib/hash";
import {
  listArtifactVersions,
  preprocessArtifactContent,
  recordArtifactVersion,
} from "@/lib/artifacts/versions";
import { SOURCE_PROMPT_META_NAME } from "@/lib/pwa";

describe("preprocessArtifactContent", () => {
  it("keeps plain HTML as HTML with no JSX source", () => {
    const out = preprocessArtifactContent({ content: "<h1>hi</h1>", title: "Hi" });
    expect(out.isJsx).toBe(false);
    expect(out.type).toBe("html");
    expect(out.originalContent).toBeNull();
    expect(out.storedContent).toContain("<h1>hi</h1>");
  });

  it("detects JSX, wraps it, and keeps the raw source in originalContent", () => {
    const jsx = "function App() { return <div className=\"x\">{1 + 1}</div>; }\nexport default App;";
    const out = preprocessArtifactContent({ content: jsx, title: "Counter" });
    expect(out.isJsx).toBe(true);
    expect(out.type).toBe("react");
    expect(out.originalContent).toBe(jsx);
    expect(out.storedContent).toContain("<!DOCTYPE html>");
  });

  it("force_html stores JSX-looking content as plain HTML", () => {
    const jsx = "function App() { return <div>{1 + 1}</div>; }";
    const out = preprocessArtifactContent({ content: jsx, title: "X", forceHtml: true });
    expect(out.isJsx).toBe(false);
    expect(out.originalContent).toBeNull();
    expect(out.storedContent).toBe(jsx);
  });

  it("bakes the source prompt into the stored page", () => {
    const out = preprocessArtifactContent({
      content: "<h1>hi</h1>",
      title: "Hi",
      sourcePrompt: "make a greeting",
    });
    expect(out.storedContent).toContain(SOURCE_PROMPT_META_NAME);
  });
});

type Row = Record<string, unknown>;

function makeAdmin(opts: {
  selectData?: Row[] | null;
  selectError?: { message: string; code?: string } | null;
  insertResult?: { data: Row | null; error: { message: string } | null };
  captured?: Row[];
}) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "in"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({
    data: opts.selectData?.[0] ?? null,
    error: opts.selectError ?? null,
  });
  chain.then = (resolve: (v: unknown) => void) =>
    resolve({ data: opts.selectData ?? [], error: opts.selectError ?? null });
  return {
    from: () => ({
      ...chain,
      insert: (payload: Row) => {
        opts.captured?.push(payload);
        return {
          select: () => ({
            single: async () => opts.insertResult ?? { data: { id: "v-new" }, error: null },
          }),
        };
      },
    }),
  } as unknown as Parameters<typeof listArtifactVersions>[0];
}

describe("listArtifactVersions", () => {
  it("flags the newest row as the head", async () => {
    const admin = makeAdmin({
      selectData: [
        { id: "v3", parent_version_id: "v2", author_key_id: null, created_at: "3" },
        { id: "v2", parent_version_id: "v1", author_key_id: null, created_at: "2" },
        { id: "v1", parent_version_id: null, author_key_id: null, created_at: "1" },
      ],
    });
    const versions = await listArtifactVersions(admin, "art-1");
    expect(versions.map((v) => v.is_head)).toEqual([true, false, false]);
    expect(versions[0].id).toBe("v3");
  });

  it("returns [] on a pre-0026 database with no versions table", async () => {
    const admin = makeAdmin({
      selectData: null,
      selectError: { message: "relation \"public.artifact_versions\" does not exist", code: "42P01" },
    });
    const versions = await listArtifactVersions(admin, "art-1");
    expect(versions).toEqual([]);
  });
});

describe("recordArtifactVersion", () => {
  it("chains a new commit to the current head when no parent is passed", async () => {
    const captured: Row[] = [];
    const admin = makeAdmin({
      selectData: [{ id: "head-1", created_at: "1" }],
      insertResult: { data: { id: "v-2", parent_version_id: "head-1" } as Row, error: null },
      captured,
    });
    const v = await recordArtifactVersion(admin, {
      artifactId: "art-1",
      userId: "user-1",
      title: "T",
      storedContent: "<h1>hi</h1>",
      contentHash: "abc",
      message: "edit",
    });
    expect(v?.id).toBe("v-2");
    expect(captured[0].parent_version_id).toBe("head-1");
  });

  it("returns null (not throw) on a pre-0026 database", async () => {
    const admin = makeAdmin({
      insertResult: {
        data: null,
        error: { message: "relation \"public.artifact_versions\" does not exist" } as never,
      },
    });
    const v = await recordArtifactVersion(admin, {
      artifactId: "art-1",
      userId: "user-1",
      title: "T",
      storedContent: "<h1>hi</h1>",
      contentHash: "abc",
      parentVersionId: null,
    });
    expect(v).toBeNull();
  });
});

const insertResponses: Array<{ data: { id: string } | null; error: { message: string } | null }> = [];
const insertedPayloads: Array<Record<string, unknown>> = [];

function saveAdmin() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return {
    from: () => ({
      ...chain,
      insert: (payload: Record<string, unknown>) => {
        insertedPayloads.push({ ...payload });
        return {
          select: () => ({
            single: async () => insertResponses.shift() ?? { data: null, error: { message: "queue empty" } },
          }),
        };
      },
    }),
  } as unknown as Parameters<typeof saveArtifactCore>[0];
}

describe("saveArtifactCore — mutable artifacts", () => {
  beforeEach(() => {
    insertResponses.length = 0;
    insertedPayloads.length = 0;
  });

  it("stores the mutable flag and records a genesis version", async () => {
    insertResponses.push(
      { data: { id: "art-1" }, error: null },
      { data: { id: "v-genesis" }, error: null }
    );
    const res = await saveArtifactCore(saveAdmin(), "user-1", {
      storedContent: "<h1>hi</h1>",
      title: "Living Doc",
      type: "html",
      visibility: "private",
      mutable: true,
      authorKind: "agent",
      authorKeyId: "key-9",
    });
    expect("error" in res).toBe(false);
    if ("error" in res) throw new Error("unexpected error");
    expect(res.mutable).toBe(true);

    const artifactPayload = insertedPayloads[0];
    expect(artifactPayload.mutable).toBe(true);

    const versionPayload = insertedPayloads[1];
    expect(versionPayload.artifact_id).toBe("art-1");
    expect(versionPayload.parent_version_id).toBeNull();
    expect(versionPayload.message).toBe("create");
    expect(versionPayload.author_kind).toBe("agent");
    expect(versionPayload.author_key_id).toBe("key-9");
    expect(versionPayload.content_hash).toBe(contentHash("<h1>hi</h1>"));
  });

  it("does not record a version for an immutable save", async () => {
    insertResponses.push({ data: { id: "art-2" }, error: null });
    const res = await saveArtifactCore(saveAdmin(), "user-1", {
      storedContent: "<h1>hi</h1>",
      title: "Static",
      type: "html",
      visibility: "private",
    });
    expect("error" in res).toBe(false);
    expect(insertedPayloads).toHaveLength(1);
    expect(insertedPayloads[0].mutable).toBe(false);
  });
});
