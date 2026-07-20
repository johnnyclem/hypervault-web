import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/github", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/github")>();
  return { ...actual, fetchUserEmail: vi.fn(async () => "octo@example.com") };
});

const calls: Array<{ table: string; op: string; payload: unknown; eq?: [string, unknown] }> = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const rec: { table: string; op: string; payload: unknown; eq?: [string, unknown] } = {
        table,
        op: "",
        payload: null,
      };
      const api: Record<string, unknown> = {};
      api.upsert = (payload: unknown) => {
        rec.op = "upsert";
        rec.payload = payload;
        calls.push(rec);
        return Promise.resolve({ error: null });
      };
      api.update = (payload: unknown) => {
        rec.op = "update";
        rec.payload = payload;
        return api;
      };
      api.eq = (col: string, val: unknown) => {
        rec.eq = [col, val];
        calls.push(rec);
        return Promise.resolve({ error: null });
      };
      return api;
    },
  }),
}));

import { POST } from "../route";

const SECRET = "webhook-secret";

function signedRequest(body: unknown, event: string, secret = SECRET): NextRequest {
  const raw = JSON.stringify(body);
  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  return new NextRequest("http://localhost/api/github/webhook", {
    method: "POST",
    body: raw,
    headers: {
      "Content-Type": "application/json",
      "x-github-event": event,
      "x-hub-signature-256": sig,
    },
  });
}

beforeEach(() => {
  calls.length = 0;
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.GITHUB_WEBHOOK_SECRET;
});

describe("POST /api/github/webhook", () => {
  it("503s when no secret is configured", async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    const res = await POST(signedRequest({}, "star", "whatever"));
    expect(res.status).toBe(503);
  });

  it("401s on an invalid signature", async () => {
    const req = new NextRequest("http://localhost/api/github/webhook", {
      method: "POST",
      body: JSON.stringify({ action: "created", sender: { id: 1, login: "octocat" } }),
      headers: { "x-github-event": "star", "x-hub-signature-256": "sha256=deadbeef" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("answers a ping", async () => {
    const res = await POST(signedRequest({ zen: "hi" }, "ping"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pong: true });
  });

  it("subscribes the sender on a new star", async () => {
    const res = await POST(
      signedRequest(
        { action: "created", starred_at: "2026-07-15T00:00:00Z", sender: { id: 42, login: "octocat" } },
        "star"
      )
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ action: "subscribed", login: "octocat" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: "github_stargazers", op: "upsert" });
    expect(calls[0].payload).toMatchObject({
      github_id: 42,
      github_login: "octocat",
      email: "octo@example.com",
      unsubscribed: false,
    });
  });

  it("unsubscribes the sender on an unstar", async () => {
    const res = await POST(
      signedRequest({ action: "deleted", sender: { id: 42, login: "octocat" } }, "star")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ action: "unsubscribed" });
    expect(calls[0]).toMatchObject({ table: "github_stargazers", op: "update", eq: ["github_id", 42] });
    expect(calls[0].payload).toMatchObject({ unsubscribed: true });
  });

  it("ignores non-star events", async () => {
    const res = await POST(signedRequest({ action: "opened" }, "issues"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: "issues" });
    expect(calls).toHaveLength(0);
  });
});
