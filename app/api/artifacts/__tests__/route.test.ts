import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  resolveApiIdentity: vi.fn(async () => ({ identity: { userId: "user-1", via: "api-key" } })),
}));

const captured: { update: Record<string, unknown> | null } = { update: null };
const responses: { row: Record<string, unknown> | null; error: { code?: string; message: string } | null } = {
  row: { id: "a1", slug: "pomodoro", title: "Pomodoro Timer", visibility: "public", icon: null },
  error: null,
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.update = (payload: Record<string, unknown>) => {
        captured.update = { ...payload };
        return chain;
      };
      chain.eq = () => chain;
      chain.select = async () => ({ data: responses.row ? [responses.row] : [], error: responses.error });
      return chain;
    },
  }),
}));

import { PATCH } from "../route";

function patch(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/artifacts", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  captured.update = null;
  responses.row = { id: "a1", slug: "pomodoro", title: "Pomodoro Timer", visibility: "public", icon: null };
  responses.error = null;
});

describe("PATCH /api/artifacts icon", () => {
  it("normalizes and stores a custom icon glyph", async () => {
    const res = await PATCH(patch({ slug: "pomodoro", icon: "Pomodoro" }));
    expect(res.status).toBe(200);
    expect(captured.update).toEqual({ icon: "Po" });
  });

  it("clears the override when icon is blank", async () => {
    const res = await PATCH(patch({ slug: "pomodoro", icon: "  " }));
    expect(res.status).toBe(200);
    expect(captured.update).toEqual({ icon: null });
  });

  it("rejects a non-string, non-null icon", async () => {
    const res = await PATCH(patch({ slug: "pomodoro", icon: 42 }));
    expect(res.status).toBe(400);
    expect(captured.update).toBeNull();
  });

  it("still supports a visibility-only update", async () => {
    const res = await PATCH(patch({ slug: "pomodoro", visibility: "private" }));
    expect(res.status).toBe(200);
    expect(captured.update).toEqual({ visibility: "private" });
  });

  it("requires at least one field to update", async () => {
    const res = await PATCH(patch({ slug: "pomodoro" }));
    expect(res.status).toBe(400);
    expect(captured.update).toBeNull();
  });

  it("surfaces the migration hint when the icon column is missing", async () => {
    responses.error = { code: "PGRST204", message: "Could not find the 'icon' column in the schema cache" };
    responses.row = null;
    const res = await PATCH(patch({ slug: "pomodoro", icon: "P" }));
    const data = await res.json();
    expect(res.status).toBe(503);
    expect(data.error).toContain("0021_artifact_icon.sql");
  });
});
