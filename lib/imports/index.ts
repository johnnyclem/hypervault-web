import type {
  CanonicalConversation,
  CanonicalMessage,
  CanonicalRole,
  SourcePlatform,
} from "@/lib/chat/canonical";
import { looksLikeChatGptExport, parseChatGptExport } from "@/lib/imports/chatgpt";
import { looksLikeClaudeExport, parseClaudeExport } from "@/lib/imports/claude";
import { looksLikeGeminiExport, parseGeminiExport } from "@/lib/imports/gemini";
import { looksLikeGrokExport, parseGrokExport } from "@/lib/imports/grok";
import { parseMarkdownTranscript } from "@/lib/imports/markdown";

export type ImportResult = {
  platform: SourcePlatform;
  conversations: CanonicalConversation[];
};

export function parseExport(raw: string, platformHint?: string): ImportResult {
  const trimmed = raw.trim();
  if (!trimmed) return { platform: "other", conversations: [] };

  let data: unknown = null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      data = JSON.parse(trimmed);
    } catch {
    }
  }

  if (data !== null) {
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>;
      if (Array.isArray(obj.conversations)) data = obj.conversations;
      else data = [data];
    }

    const hint = (platformHint ?? "").toLowerCase();
    if (hint === "chatgpt" || looksLikeChatGptExport(data)) {
      return { platform: "chatgpt", conversations: parseChatGptExport(data as never) };
    }
    if (hint === "claude" || looksLikeClaudeExport(data)) {
      return { platform: "claude", conversations: parseClaudeExport(data as never) };
    }
    if (hint === "grok" || looksLikeGrokExport(data)) {
      return { platform: "grok", conversations: parseGrokExport(data as never) };
    }
    if (hint === "gemini" || looksLikeGeminiExport(data)) {
      return { platform: "gemini", conversations: parseGeminiExport(data as never) };
    }
    const generic = parseGenericJson(data);
    if (generic.length > 0) return { platform: "other", conversations: generic };
  }

  return { platform: "other", conversations: parseMarkdownTranscript(trimmed) };
}

const ROLES = new Set<CanonicalRole>(["system", "user", "assistant", "tool"]);

function parseGenericJson(data: unknown): CanonicalConversation[] {
  if (!Array.isArray(data)) return [];
  const out: CanonicalConversation[] = [];

  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const rawMessages = Array.isArray(obj.messages) ? obj.messages : null;
    if (!rawMessages) continue;

    const messages: CanonicalMessage[] = [];
    for (const m of rawMessages) {
      if (!m || typeof m !== "object") continue;
      const msg = m as Record<string, unknown>;
      const role = typeof msg.role === "string" ? msg.role : "";
      const content =
        typeof msg.content === "string" ? msg.content : typeof msg.text === "string" ? msg.text : "";
      if (!ROLES.has(role as CanonicalRole) || !content.trim()) continue;
      messages.push({ role: role as CanonicalRole, content: content.trim(), attachments: [] });
    }
    if (messages.length === 0) continue;

    out.push({
      platform: "other",
      externalId: typeof obj.id === "string" ? obj.id : undefined,
      title:
        (typeof obj.title === "string" && obj.title.trim()) ||
        messages[0].content.slice(0, 60),
      messages,
    });
  }
  return out;
}
