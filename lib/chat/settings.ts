import type { SupabaseClient } from "@supabase/supabase-js";


export type ChatContextSettings = {
  smartContext: boolean;
  deepMemory: boolean;
  polytician: boolean;
};

export const DEFAULT_CHAT_CONTEXT_SETTINGS: ChatContextSettings = {
  smartContext: true,
  deepMemory: true,
  polytician: true,
};

export async function loadChatContextSettings(
  db: SupabaseClient,
  userId: string
): Promise<ChatContextSettings> {
  try {
    const { data, error } = await db
      .from("profiles")
      .select("chat_smart_context, chat_deep_memory, chat_polytician")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) {
      const { data: legacy } = await db
        .from("profiles")
        .select("chat_smart_context, chat_deep_memory")
        .eq("id", userId)
        .maybeSingle();
      if (!legacy) return { ...DEFAULT_CHAT_CONTEXT_SETTINGS };
      return {
        smartContext: legacy.chat_smart_context !== false,
        deepMemory: legacy.chat_deep_memory !== false,
        polytician: true,
      };
    }
    return {
      smartContext: data.chat_smart_context !== false,
      deepMemory: data.chat_deep_memory !== false,
      polytician: data.chat_polytician !== false,
    };
  } catch {
    return { ...DEFAULT_CHAT_CONTEXT_SETTINGS };
  }
}
