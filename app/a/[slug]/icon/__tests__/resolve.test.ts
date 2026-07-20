import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { resolveArtifactIcon } from "../resolve";

beforeEach(() => {
  state.artifact = null;
  state.canOpen = false;
  state.viewer = null;
});

describe("resolveArtifactIcon", () => {
  it("falls back (null) for an unknown artifact", async () => {
    state.artifact = null;
    expect(await resolveArtifactIcon("nope")).toBeNull();
  });

  it("does not leak a private artifact's icon to a viewer without access", async () => {
    state.artifact = { slug: "secret", title: "Secret App", visibility: "private" };
    state.canOpen = false;
    state.viewer = { id: "someone-else" };
    expect(await resolveArtifactIcon("secret")).toBeNull();
  });

  it("renders the title initial for a public artifact with no custom icon", async () => {
    state.artifact = { slug: "pomodoro", title: "Pomodoro Timer", visibility: "public" };
    const resolved = await resolveArtifactIcon("pomodoro");
    expect(resolved).not.toBeNull();
    expect(resolved?.glyph).toBe("P");
    expect(resolved?.isPrivate).toBe(false);
    expect(resolved?.gradient).toHaveLength(2);
  });

  it("renders the user's custom glyph over the title initial", async () => {
    state.artifact = { slug: "pomodoro", title: "Pomodoro Timer", visibility: "public", icon: "🍅" };
    const resolved = await resolveArtifactIcon("pomodoro");
    expect(resolved?.glyph).toBe("🍅");
  });

  it("renders for the owner of a private artifact and marks it private", async () => {
    state.artifact = { slug: "secret", title: "Secret App", visibility: "private" };
    state.canOpen = true;
    state.viewer = { id: "owner" };
    const resolved = await resolveArtifactIcon("secret");
    expect(resolved?.glyph).toBe("S");
    expect(resolved?.isPrivate).toBe(true);
  });
});
