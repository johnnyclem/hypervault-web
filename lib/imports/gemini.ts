import {
  type CanonicalConversation,
  type CanonicalMessage,
  toIso,
} from "@/lib/chat/canonical";


type GeminiActivityItem = {
  header?: string;
  title?: string;
  time?: string;
  subtitles?: { name?: string }[];
  safeHtmlItem?: { html?: string }[];
};

export function looksLikeGeminiExport(data: unknown): data is GeminiActivityItem[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    data.every(
      (item) =>
        item &&
        typeof item === "object" &&
        (("header" in item && /gemini|bard/i.test(String((item as GeminiActivityItem).header))) ||
          /^Prompted /.test(String((item as GeminiActivityItem).title ?? "")))
    )
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

export function parseGeminiExport(data: GeminiActivityItem[]): CanonicalConversation[] {
  const byDay = new Map<string, CanonicalMessage[]>();

  for (const item of [...data].reverse()) {
    const prompt = (item.title ?? "").replace(/^Prompted\s+/i, "").trim();
    if (!prompt) continue;

    const iso = toIso(item.time);
    const day = iso ? iso.slice(0, 10) : "unknown";
    const messages = byDay.get(day) ?? [];

    messages.push({ role: "user", content: prompt, attachments: [], createdAt: iso });

    const replyHtml = item.safeHtmlItem?.map((h) => h.html ?? "").join("\n") ?? "";
    const reply = replyHtml ? stripHtml(replyHtml) : "";
    if (reply) {
      messages.push({ role: "assistant", content: reply, attachments: [], createdAt: iso });
    }

    byDay.set(day, messages);
  }

  return [...byDay.entries()].map(([day, messages]) => ({
    platform: "gemini" as const,
    externalId: `takeout-${day}`,
    title: day === "unknown" ? "Gemini history" : `Gemini — ${day}`,
    createdAt: messages[0]?.createdAt,
    updatedAt: messages[messages.length - 1]?.createdAt,
    messages,
  }));
}
