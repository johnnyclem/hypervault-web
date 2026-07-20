import {
  type CanonicalAttachment,
  type CanonicalConversation,
  type CanonicalMessage,
  toIso,
} from "@/lib/chat/canonical";


type ClaudeMessage = {
  uuid?: string;
  text?: string;
  content?: { type?: string; text?: string }[];
  sender?: string;
  created_at?: string;
  attachments?: {
    file_name?: string;
    file_type?: string;
    file_size?: number;
    extracted_content?: string;
  }[];
  files?: { file_name?: string }[];
};

export type ClaudeConversation = {
  uuid?: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  chat_messages?: ClaudeMessage[];
};

export function looksLikeClaudeExport(data: unknown): data is ClaudeConversation[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    data.every((c) => c && typeof c === "object" && "chat_messages" in c)
  );
}

function claudeText(msg: ClaudeMessage): string {
  if (Array.isArray(msg.content) && msg.content.length > 0) {
    return msg.content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  return msg.text ?? "";
}

export function parseClaudeExport(data: ClaudeConversation[]): CanonicalConversation[] {
  return data.map((convo) => {
    const messages: CanonicalMessage[] = [];

    for (const msg of convo.chat_messages ?? []) {
      const text = claudeText(msg).trim();
      const attachments: CanonicalAttachment[] = [
        ...(msg.attachments ?? []).map((a) => ({
          name: a.file_name ?? "attachment",
          mime_type: a.file_type,
          size: a.file_size,
          extracted_text: a.extracted_content,
        })),
        ...(msg.files ?? []).map((f) => ({ name: f.file_name ?? "file" })),
      ];
      if (!text && attachments.length === 0) continue;

      messages.push({
        role: msg.sender === "human" ? "user" : "assistant",
        content: text,
        attachments,
        createdAt: toIso(msg.created_at),
      });
    }

    return {
      platform: "claude" as const,
      externalId: convo.uuid,
      title: convo.name?.trim() || "Untitled conversation",
      createdAt: toIso(convo.created_at),
      updatedAt: toIso(convo.updated_at),
      messages,
    };
  });
}
