
export const CONVERSATION_VISIBILITIES = ["private", "shared", "public"] as const;

export type ConversationVisibility = (typeof CONVERSATION_VISIBILITIES)[number];

export function parseVisibility(value: unknown): ConversationVisibility | null {
  return typeof value === "string" &&
    (CONVERSATION_VISIBILITIES as readonly string[]).includes(value)
    ? (value as ConversationVisibility)
    : null;
}

export function sharePath(slug: string): string {
  return `/c/${slug}`;
}
