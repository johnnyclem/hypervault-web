import {
  type CanonicalConversation,
  type CanonicalMessage,
  toIso,
} from "@/lib/chat/canonical";


type GrokResponse = {
  message?: string;
  sender?: string;
  create_time?: number | string;
};

export type GrokConversation = {
  conversation_id?: string;
  title?: string;
  create_time?: number | string;
  responses?: GrokResponse[];
};

export function looksLikeGrokExport(data: unknown): data is GrokConversation[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    data.every((c) => c && typeof c === "object" && "responses" in c)
  );
}

export function parseGrokExport(data: GrokConversation[]): CanonicalConversation[] {
  return data.map((convo) => {
    const messages: CanonicalMessage[] = [];

    for (const r of convo.responses ?? []) {
      const text = (r.message ?? "").trim();
      if (!text) continue;
      messages.push({
        role: r.sender === "human" || r.sender === "user" ? "user" : "assistant",
        content: text,
        attachments: [],
        createdAt: toIso(r.create_time),
      });
    }

    return {
      platform: "grok" as const,
      externalId: convo.conversation_id,
      title:
        convo.title?.trim() ||
        (messages[0]?.content ?? "Untitled conversation").slice(0, 60),
      createdAt: toIso(convo.create_time),
      messages,
    };
  });
}
