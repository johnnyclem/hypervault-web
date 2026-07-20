import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadChatContextSettings } from "@/lib/chat/settings";

type Row = Record<string, unknown> | null;

function dbWith(result: { data: Row; error: { code?: string; message: string } | null }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

describe("loadChatContextSettings", () => {
  it("reads persisted values", async () => {
    const db = dbWith({ data: { chat_smart_context: false, chat_deep_memory: true }, error: null });
    expect(await loadChatContextSettings(db, "user-1")).toEqual({
      smartContext: false,
      deepMemory: true,
      polytician: true,
    });
  });

  it("defaults ON when the columns predate migration 0017", async () => {
    const db = dbWith({
      data: null,
      error: { code: "42703", message: "column profiles.chat_smart_context does not exist" },
    });
    expect(await loadChatContextSettings(db, "user-1")).toEqual({
      smartContext: true,
      deepMemory: true,
      polytician: true,
    });
  });

  it("defaults ON when there is no profile row and treats null columns as ON", async () => {
    expect(
      await loadChatContextSettings(dbWith({ data: null, error: null }), "user-1")
    ).toEqual({ smartContext: true, deepMemory: true, polytician: true });
    expect(
      await loadChatContextSettings(
        dbWith({ data: { chat_smart_context: null, chat_deep_memory: null }, error: null }),
        "user-1"
      )
    ).toEqual({ smartContext: true, deepMemory: true, polytician: true });
  });

  it("defaults ON when the query itself throws", async () => {
    const db = {
      from: () => {
        throw new Error("connection reset");
      },
    } as unknown as SupabaseClient;
    expect(await loadChatContextSettings(db, "user-1")).toEqual({
      smartContext: true,
      deepMemory: true,
      polytician: true,
    });
  });
});
