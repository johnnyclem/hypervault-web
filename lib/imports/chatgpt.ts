import {
  type CanonicalAttachment,
  type CanonicalConversation,
  type CanonicalMessage,
  toIso,
} from "@/lib/chat/canonical";


type ChatGptNode = {
  id?: string;
  message?: ChatGptMessage | null;
  parent?: string | null;
  children?: string[];
};

type ChatGptMessage = {
  id?: string;
  author?: { role?: string };
  create_time?: number | null;
  content?: {
    content_type?: string;
    parts?: unknown[];
    text?: string;
    language?: string;
  };
  metadata?: {
    attachments?: { id?: string; name?: string; mime_type?: string; size?: number }[];
    is_visually_hidden_from_conversation?: boolean;
    model_slug?: string;
  };
  recipient?: string;
};

export type ChatGptConversation = {
  title?: string;
  create_time?: number;
  update_time?: number;
  mapping?: Record<string, ChatGptNode>;
  current_node?: string;
  conversation_id?: string;
  id?: string;
  default_model_slug?: string;
};

export function looksLikeChatGptExport(data: unknown): data is ChatGptConversation[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    data.every((c) => c && typeof c === "object" && "mapping" in c)
  );
}

function messageText(msg: ChatGptMessage): string {
  const content = msg.content;
  if (!content) return "";
  switch (content.content_type) {
    case "code":
      return content.text ? `\`\`\`${content.language ?? ""}\n${content.text}\n\`\`\`` : "";
    case "execution_output":
      return content.text ? `\`\`\`\n${content.text}\n\`\`\`` : "";
    default: {
      const parts = Array.isArray(content.parts) ? content.parts : [];
      return parts
        .map((p) => {
          if (typeof p === "string") return p;
          if (p && typeof p === "object" && "asset_pointer" in p) return "[image]";
          return "";
        })
        .filter(Boolean)
        .join("\n");
    }
  }
}

function mainThread(convo: ChatGptConversation): ChatGptMessage[] {
  const mapping = convo.mapping ?? {};
  const thread: ChatGptMessage[] = [];
  const seen = new Set<string>();
  let nodeId: string | null | undefined =
    convo.current_node ??
    Object.keys(mapping).find((id) => (mapping[id].children ?? []).length === 0);

  while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
    seen.add(nodeId);
    const node: ChatGptNode = mapping[nodeId];
    if (node.message) thread.push(node.message);
    nodeId = node.parent;
  }
  return thread.reverse();
}

export function parseChatGptExport(data: ChatGptConversation[]): CanonicalConversation[] {
  return data.map((convo) => {
    const messages: CanonicalMessage[] = [];

    for (const msg of mainThread(convo)) {
      const role = msg.author?.role;
      if (!role || role === "system") continue;
      if (msg.metadata?.is_visually_hidden_from_conversation) continue;
      if (msg.recipient && msg.recipient !== "all") continue;

      const text = messageText(msg).trim();
      const attachments: CanonicalAttachment[] = (msg.metadata?.attachments ?? []).map((a) => ({
        name: a.name ?? a.id ?? "attachment",
        mime_type: a.mime_type,
        size: a.size,
      }));
      if (!text && attachments.length === 0) continue;

      messages.push({
        role: role === "user" ? "user" : role === "tool" ? "tool" : "assistant",
        content: text,
        attachments,
        model: msg.metadata?.model_slug,
        createdAt: toIso(msg.create_time),
      });
    }

    return {
      platform: "chatgpt" as const,
      externalId: convo.conversation_id ?? convo.id,
      title: convo.title?.trim() || "Untitled conversation",
      model: convo.default_model_slug,
      createdAt: toIso(convo.create_time),
      updatedAt: toIso(convo.update_time),
      messages,
    };
  });
}
