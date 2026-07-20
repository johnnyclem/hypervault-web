import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { pickBackend, type InferenceBackendRow } from "@/lib/polytician/inference";

function row(over: Partial<InferenceBackendRow>): InferenceBackendRow {
  return {
    id: "b", provider: "openai", base_url: null, default_model: "gpt", api_key_cipher: null,
    last_used_at: null, created_at: "2026-01-01T00:00:00.000Z", ...over,
  };
}

describe("pickBackend", () => {
  it("returns null with no backends", () => {
    expect(pickBackend([])).toBeNull();
  });

  it("prefers the most recently used backend", () => {
    const picked = pickBackend([
      row({ id: "old", last_used_at: "2026-01-01T00:00:00.000Z" }),
      row({ id: "recent", last_used_at: "2026-06-01T00:00:00.000Z" }),
    ]);
    expect(picked?.id).toBe("recent");
  });

  it("falls back to newest created when nothing has been used", () => {
    const picked = pickBackend([
      row({ id: "a", created_at: "2026-01-01T00:00:00.000Z" }),
      row({ id: "b", created_at: "2026-05-01T00:00:00.000Z" }),
    ]);
    expect(picked?.id).toBe("b");
  });

  it("prefers a local backend when preferredBackend is 'local'", () => {
    const picked = pickBackend(
      [
        row({ id: "cloud", provider: "anthropic", last_used_at: "2026-06-01T00:00:00.000Z" }),
        row({ id: "local", provider: "ollama", last_used_at: "2026-01-01T00:00:00.000Z" }),
      ],
      "local"
    );
    expect(picked?.id).toBe("local");
  });

  it("falls back to most-recent when 'local' is requested but none exists", () => {
    const picked = pickBackend([row({ id: "cloud", provider: "anthropic", last_used_at: "2026-06-01T00:00:00.000Z" })], "local");
    expect(picked?.id).toBe("cloud");
  });
});

vi.mock("@/lib/api-auth", () => ({
  resolveApiIdentity: vi.fn(async () => ({ identity: { userId: "user-1", via: "api-key", keyId: "k" } })),
}));
const sendChat = vi.fn((..._args: unknown[]) => Promise.resolve({ text: "hi there", model: "gpt-4o", truncated: false }));
vi.mock("@/lib/backends/chat", () => ({ sendChat: (...a: unknown[]) => sendChat(...a) }));
vi.mock("@/lib/backends/crypto", () => ({ decryptSecret: () => "decrypted" }));

let backendRows: InferenceBackendRow[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: async () => ({ data: backendRows, error: null }) }),
      update: () => ({ eq: () => {} }),
    }),
  }),
}));

import { POST } from "../route";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/inference", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", authorization: "Bearer hv_test" },
  });
}

beforeEach(() => {
  backendRows = [];
  sendChat.mockClear();
});

describe("POST /api/inference", () => {
  it("404s with code NO_BACKEND when the user has no connected backend", async () => {
    const res = await POST(post({ prompt: "hello" }));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NO_BACKEND");
    expect(sendChat).not.toHaveBeenCalled();
  });

  it("runs the completion and returns text + backend label", async () => {
    backendRows = [row({ id: "b1", provider: "openai", default_model: "gpt-4o", last_used_at: "2026-06-01T00:00:00.000Z" })];
    const res = await POST(post({ prompt: "hello", maxTokens: 500 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe("hi there");
    expect(body.backend).toBe("openai:gpt-4o");
    expect(typeof body.latencyMs).toBe("number");
    expect(sendChat.mock.calls[0][3] as unknown).toEqual({ maxTokens: 1024 });
  });

  it("maps a backend failure to 502 BACKEND_ERROR", async () => {
    backendRows = [row({ id: "b1" })];
    sendChat.mockRejectedValueOnce(new Error("upstream 500"));
    const res = await POST(post({ prompt: "hello" }));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("BACKEND_ERROR");
  });

  it("requires a prompt", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
  });
});
