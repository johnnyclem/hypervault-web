
export type SourcePlatform =
  | "chatgpt"
  | "claude"
  | "gemini"
  | "grok"
  | "hypervault"
  | "other";

export type CanonicalRole = "system" | "user" | "assistant" | "tool";

export type CanonicalAttachment = {
  name: string;
  mime_type?: string;
  size?: number;
  extracted_text?: string;
};

export type CanonicalMessage = {
  role: CanonicalRole;
  content: string;
  attachments: CanonicalAttachment[];
  model?: string;
  createdAt?: string;
};

export type CanonicalConversation = {
  platform: SourcePlatform;
  externalId?: string;
  title: string;
  model?: string;
  createdAt?: string;
  updatedAt?: string;
  messages: CanonicalMessage[];
};

export function toIso(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string" && value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
}
