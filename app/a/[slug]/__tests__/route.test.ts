import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state: {
  artifact: Record<string, unknown> | null;
  canOpen: boolean;
  viewer: { id: string } | null;
} = { artifact: null, canOpen: false, viewer: null };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));
vi.mock("@/lib/supabase/server", () => ({
  getUser: vi.fn(async () => state.viewer),
}));
vi.mock("@/lib/visibility", () => ({
  fetchArtifactBySlug: vi.fn(async () => state.artifact),
  isPrivateArtifact: (a: { visibility?: string }) => (a.visibility ?? "public") === "private",
  canViewerOpenArtifact: vi.fn(async () => state.canOpen),
}));
vi.mock("@/lib/utils", () => ({
  appUrl: () => "https://hypervault.store",
}));

import { GET } from "../route";

function get(slug: string, host?: string) {
  return GET(
    new NextRequest(`https://${host ?? "claudedamnit.com"}/a/${slug}`, {
      headers: host ? { host } : undefined,
    }),
    { params: Promise.resolve({ slug }) }
  );
}

beforeEach(() => {
  state.artifact = null;
  state.canOpen = false;
  state.viewer = null;
});

describe("GET /a/[slug] lock page", () => {
  it("sends a signed-out viewer to sign in with a next back to the artifact", async () => {
    state.artifact = { slug: "my-thing", title: "T", content: "<p>secret</p>", visibility: "private" };
    state.canOpen = false;
    state.viewer = null;

    const res = await get("my-thing");
    const body = await res.text();

    expect(res.status).toBe(401);
    expect(body).toContain(
      `href="https://hypervault.store/login?next=${encodeURIComponent("/a/my-thing")}"`
    );
  });

  it("keeps sign-in on the current base domain, where the viewer's session lives", async () => {
    state.artifact = { slug: "my-thing", title: "T", content: "<p>secret</p>", visibility: "private" };
    state.canOpen = false;
    state.viewer = null;

    const res = await get("my-thing", "someone.claudedamnit.com");
    const body = await res.text();

    expect(body).toContain(
      `href="https://claudedamnit.com/login?next=${encodeURIComponent("/a/my-thing")}"`
    );
    expect(body).not.toContain("hypervault.store/login");
  });

  it("self-retries once when a session cookie exists but the viewer resolved signed-out", async () => {
    state.artifact = { slug: "my-thing", title: "T", content: "<p>secret</p>", visibility: "private" };
    state.canOpen = false;
    state.viewer = null;

    const body = await (await get("my-thing")).text();

    expect(body).toContain("hv-lock-retry");
    expect(body).toContain("location.reload");
  });

  it("does not embed the retry script for signed-in viewers without access", async () => {
    state.artifact = { slug: "my-thing", title: "T", content: "<p>secret</p>", visibility: "private" };
    state.canOpen = false;
    state.viewer = { id: "someone-else" };

    const body = await (await get("my-thing")).text();
    expect(body).not.toContain("hv-lock-retry");
  });

  it("does not offer sign-in to a signed-in viewer without access", async () => {
    state.artifact = { slug: "my-thing", title: "T", content: "<p>secret</p>", visibility: "private" };
    state.canOpen = false;
    state.viewer = { id: "someone-else" };

    const res = await get("my-thing");
    const body = await res.text();

    expect(res.status).toBe(403);
    expect(body).not.toContain("/login?next=");
    expect(body).toContain("ask the owner to invite you");
  });

  it("serves the content when the viewer may open it", async () => {
    state.artifact = { slug: "my-thing", title: "T", content: "<p>secret</p>", visibility: "private" };
    state.canOpen = true;
    state.viewer = { id: "owner" };

    const res = await get("my-thing");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("<p>secret</p>");
  });
});
