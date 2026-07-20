import { CompactionEngine } from "@/lib/vendor/short-hand/compaction/compaction-engine";
import type { ConversationMessage } from "@/lib/vendor/short-hand/types";
import { CompactionLevel } from "@/lib/vendor/short-hand/types";
import type { CanonicalMessage } from "@/lib/chat/canonical";


export const KEEP_RAW_TURNS = 12;
export const COMPACT_BUDGET_TOKENS = 3_000;
export const MIN_MESSAGES_TO_COMPACT = KEEP_RAW_TURNS + 8;

const LEVEL_LABEL: Record<number, string> = {
  [CompactionLevel.L4_INVARIANTS]: "Standing facts and corrections",
  [CompactionLevel.L3_GRAPH]: "Entities and relationships",
  [CompactionLevel.L2_SUMMARIES]: "Topic summaries",
  [CompactionLevel.L1_COMPACTED]: "Condensed earlier turns",
  [CompactionLevel.L0_MEMTABLE]: "Recent earlier turns",
};

export type CompactedHistory = {
  keptMessages: CanonicalMessage[];
  contextBlock: string;
};

function messageText(m: CanonicalMessage): string {
  const extracted = m.attachments
    .map((a) => a.extracted_text?.trim())
    .filter((t): t is string => !!t);
  return extracted.length > 0 ? [m.content, ...extracted].join("\n\n") : m.content;
}

export async function compactChatHistory(
  canonical: CanonicalMessage[]
): Promise<CompactedHistory | null> {
  try {
    if (canonical.length < MIN_MESSAGES_TO_COMPACT) return null;

    const older = canonical.slice(0, -KEEP_RAW_TURNS);
    const keptMessages = canonical.slice(-KEEP_RAW_TURNS);

    const base = Date.now() - older.length;
    const messages: ConversationMessage[] = older.map((m, i) => ({
      id: String(i),
      role: m.role,
      content: messageText(m),
      timestamp: m.createdAt ? new Date(m.createdAt).getTime() : base + i,
    }));

    const engine = new CompactionEngine({
      preferredTier: "regex",
      autoFallback: true,
      memtableSize: 10,
      contextBudget: COMPACT_BUDGET_TOKENS,
    });
    await engine.addMessages(messages);
    await engine.flush();

    const frame = engine.buildContextFrame(COMPACT_BUDGET_TOKENS);
    if (frame.sections.length === 0) return null;

    const parts = frame.sections.map((s) => {
      const label = LEVEL_LABEL[s.level] ?? "Context";
      return `### ${label}\n${s.content}`;
    });
    const contextBlock = [
      "## Conversation so far (compacted)",
      "This thread is longer than the turns shown below. Its earlier turns were progressively summarized — standing facts first, then entities, topics, and condensed lines. Treat this as established conversation history; the most recent turns follow verbatim as regular messages.",
      ...parts,
    ].join("\n\n");

    return { keptMessages, contextBlock };
  } catch {
    return null;
  }
}
