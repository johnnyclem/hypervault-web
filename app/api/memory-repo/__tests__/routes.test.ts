import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";


vi.mock("@/lib/api-auth", () => ({
  resolveApiIdentity: vi.fn(async () => ({ identity: { userId: "user-1", via: "api-key", keyId: "key-1" } })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

const branch = { id: "branch-1", name: "polytician-main", is_default: false, head_commit_id: "commit-0" };
const heads = new Map<string, { title: string; content: string; summary: string; tags: string[]; source: string; committed_at: string; memory_id: string; revision_id: string; commit_id: string }>();
const recordCommit = vi.fn((..._args: unknown[]): Promise<string> => Promise.resolve("commit-new"));

function commitChanges(call = 0): Array<{ op: string; memory_id: string }> {
  return recordCommit.mock.calls[call][4] as Array<{ op: string; memory_id: string }>;
}

vi.mock("@/lib/mind/branches", () => ({
  DEFAULT_BRANCH: "main",
}));
vi.mock("@/lib/polytician/repo", () => ({
  ensurePolyticianBranch: vi.fn(async () => branch),
  loadConceptRowsByMemory: vi.fn(async () => new Map()),
  upsertConcept: vi.fn(async () => {}),
  clearConceptThoughtform: vi.fn(async () => {}),
  deleteConcept: vi.fn(async () => {}),
  getConceptById: vi.fn(async () => null),
}));
vi.mock("@/lib/mind/commits", () => ({ recordCommit: (...a: unknown[]) => recordCommit(...a) }));
vi.mock("@/lib/mind/state", () => ({
  branchState: vi.fn(async () => [...heads.values()]),
  headSnapshot: vi.fn(async (_db: unknown, _u: string, _b: string, memoryId: string) => heads.get(memoryId) ?? null),
}));

import { POST as commitsPOST } from "../commits/route";
import { POST as tombstonePOST } from "../tombstone/route";
import { GET as branchGET } from "../branches/[branch]/route";
import { conceptIdToMemoryId } from "@/lib/polytician/bridge";

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", authorization: "Bearer hv_test" },
  });
}

function mdEntry(conceptId: string, data: string, over: Record<string, unknown> = {}) {
  return {
    key: `concepts/${conceptId}/markdown`,
    contentType: "markdown",
    data,
    tags: ["note"],
    metadata: { conceptId, namespace: "default", version: 1, updatedAt: 1709555555000, ...over },
  };
}

beforeEach(async () => {
  heads.clear();
  recordCommit.mockReset();
  recordCommit.mockImplementation(async (...args: unknown[]) => {
    const changes = args[4] as Array<{ memory_id: string; op: string; title: string; content: string; summary: string; tags: string[]; source: string }>;
    for (const c of changes) {
      if (c.op === "delete") heads.delete(c.memory_id);
      else heads.set(c.memory_id, {
        memory_id: c.memory_id, title: c.title, content: c.content, summary: c.summary,
        tags: c.tags, source: c.source, committed_at: "2026-02-01T00:00:00.000Z", revision_id: "r", commit_id: "commit-new",
      });
    }
    return "commit-new";
  });
});

describe("POST /api/memory-repo/commits", () => {
  it("creates a memory for a new concept and echoes canonical entries", async () => {
    const uuid = conceptIdToMemoryId("c-new");
    const res = await commitsPOST(post("/api/memory-repo/commits", {
      branch: "polytician-main",
      message: "sync one",
      entries: [mdEntry("c-new", "# Hello\n\nworld")],
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sha).toBe("commit-new");
    expect(body.branch).toBe("polytician-main");
    const change = commitChanges()[0];
    expect(change.op).toBe("create");
    expect(change.memory_id).toBe(uuid);
    expect(body.entries[0].key).toBe("concepts/c-new/markdown");
  });

  it("classifies an existing memory as an update", async () => {
    const uuid = conceptIdToMemoryId("c-old");
    heads.set(uuid, {
      memory_id: uuid, title: "Old", content: "old", summary: "old", tags: [], source: "agent",
      committed_at: "2026-01-01T00:00:00.000Z", revision_id: "r0", commit_id: "commit-0",
    });
    await commitsPOST(post("/api/memory-repo/commits", {
      branch: "polytician-main",
      entries: [mdEntry("c-old", "# Old\n\nnew body")],
    }));
    expect(commitChanges()[0].op).toBe("update");
  });

  it("rejects unrecognized entry keys", async () => {
    const res = await commitsPOST(post("/api/memory-repo/commits", {
      branch: "polytician-main",
      entries: [{ key: "concepts/x/vector", contentType: "json", data: "[]", tags: [], metadata: {} }],
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_KEY");
  });

  it("requires a branch", async () => {
    const res = await commitsPOST(post("/api/memory-repo/commits", { entries: [] }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/memory-repo/tombstone", () => {
  it("records a delete commit when the memory exists, returning JSON (not 204)", async () => {
    const uuid = conceptIdToMemoryId("c-del");
    heads.set(uuid, {
      memory_id: uuid, title: "Doomed", content: "bye", summary: "bye", tags: [], source: "agent",
      committed_at: "2026-01-01T00:00:00.000Z", revision_id: "r0", commit_id: "commit-0",
    });
    const res = await tombstonePOST(post("/api/memory-repo/tombstone", {
      branch: "polytician-main",
      key: "concepts/c-del/markdown",
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, key: "concepts/c-del/markdown" });
    expect(commitChanges()[0].op).toBe("delete");
  });

  it("is idempotent when the memory is already gone (no commit, still 200 JSON)", async () => {
    const res = await tombstonePOST(post("/api/memory-repo/tombstone", {
      branch: "polytician-main",
      key: "concepts/absent/markdown",
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(recordCommit).not.toHaveBeenCalled();
  });

  it("rejects a malformed key", async () => {
    const res = await tombstonePOST(post("/api/memory-repo/tombstone", { branch: "polytician-main", key: "nope" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/memory-repo/branches/[branch]", () => {
  it("returns the branch state as concept entries with an opaque headSha", async () => {
    const uuid = conceptIdToMemoryId("c1");
    heads.set(uuid, {
      memory_id: uuid, title: "One", content: "# One", summary: "one", tags: ["t"], source: "agent",
      committed_at: "2026-01-01T00:00:00.000Z", revision_id: "r1", commit_id: "commit-1",
    });
    const req = new NextRequest("http://localhost/api/memory-repo/branches/polytician-main", {
      headers: { authorization: "Bearer hv_test" },
    });
    const res = await branchGET(req, { params: Promise.resolve({ branch: "polytician-main" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branch).toBe("polytician-main");
    expect(body.headSha).toBe("commit-0");
    expect(body.entries[0].contentType).toBe("markdown");
  });
});
