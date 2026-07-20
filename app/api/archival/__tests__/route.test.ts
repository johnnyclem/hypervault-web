import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  resolveApiIdentity: vi.fn(async () => ({ identity: { userId: "user-1", via: "api-key", keyId: "k" } })),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const saveArtifactCore = vi.fn();
vi.mock("@/lib/artifacts/save", () => ({ saveArtifactCore: (...a: unknown[]) => saveArtifactCore(...a) }));

import { POST } from "../upload/route";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/archival/upload", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", authorization: "Bearer hv_test" },
  });
}

beforeEach(() => saveArtifactCore.mockReset());

describe("POST /api/archival/upload", () => {
  it("returns an Arweave-receipt-shaped body with txId = slug", async () => {
    saveArtifactCore.mockResolvedValue({
      slug: "my-note-abcd", url: "https://hypervault.store/a/my-note-abcd",
      visibility: "private", isJsx: false, isPwa: false, duplicate: false, id: "art-1",
      connections: { manual: 0, auto: 0 },
    });
    const res = await POST(post({ content: "# My Note\n\nbody", contentType: "markdown", tags: ["t"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.txId).toBe("my-note-abcd");
    expect(body.url).toBe("https://hypervault.store/a/my-note-abcd");
    expect(body.tags).toEqual(["t"]);
    expect(body.size).toBeGreaterThan(0);
    expect(saveArtifactCore.mock.calls[0][2]).toMatchObject({ visibility: "private", isPwa: false });
  });

  it("is idempotent — a dedupe hit still returns a receipt", async () => {
    saveArtifactCore.mockResolvedValue({
      slug: "existing", url: "https://hypervault.store/a/existing",
      visibility: "private", isJsx: false, isPwa: false, duplicate: true,
      existing: { title: "Existing", visibility: "private" },
    });
    const res = await POST(post({ content: "same bytes" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.txId).toBe("existing");
    expect(body.duplicate).toBe(true);
  });

  it("maps a save failure to ARCHIVE_FAILED", async () => {
    saveArtifactCore.mockResolvedValue({ error: "insert failed", status: 500 });
    const res = await POST(post({ content: "boom" }));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("ARCHIVE_FAILED");
  });

  it("requires content", async () => {
    const res = await POST(post({ tags: [] }));
    expect(res.status).toBe(400);
    expect(saveArtifactCore).not.toHaveBeenCalled();
  });
});
