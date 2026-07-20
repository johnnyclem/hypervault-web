import type { CanonicalConversation, CanonicalMessage, CanonicalRole } from "@/lib/chat/canonical";


const SPEAKER_ALIASES: Record<string, CanonicalRole> = {
  user: "user",
  human: "user",
  me: "user",
  you: "user",
  prompt: "user",
  assistant: "assistant",
  ai: "assistant",
  chatgpt: "assistant",
  gpt: "assistant",
  claude: "assistant",
  gemini: "assistant",
  bard: "assistant",
  grok: "assistant",
  model: "assistant",
  system: "system",
};

const SPEAKER_LINE = new RegExp(
  `^(?:#+\\s*)?(?:\\*\\*)?(${Object.keys(SPEAKER_ALIASES).join("|")})(?:\\*\\*)?\\s*[:：]\\s*(.*)$`,
  "i"
);

export function parseMarkdownTranscript(text: string, title?: string): CanonicalConversation[] {
  const messages: CanonicalMessage[] = [];
  let current: CanonicalMessage | null = null;

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(SPEAKER_LINE);
    if (match) {
      if (current) {
        current.content = current.content.trim();
        if (current.content) messages.push(current);
      }
      current = {
        role: SPEAKER_ALIASES[match[1].toLowerCase()],
        content: match[2] ?? "",
        attachments: [],
      };
    } else if (current) {
      current.content += `\n${line}`;
    }
  }
  if (current) {
    current.content = current.content.trim();
    if (current.content) messages.push(current);
  }

  if (messages.length === 0) return [];

  return [
    {
      platform: "other",
      title: title?.trim() || messages[0].content.slice(0, 60) || "Pasted conversation",
      messages,
    },
  ];
}
