import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiIdentity } from "@/lib/api-auth";
import { embedMemoryBestEffort } from "@/lib/backends/embeddings";
import { autoTags, summarize, suggestLinkChangesForMemory, syncArtifactLinksForMemory } from "@/lib/memory";
import { ensureMainBranch } from "@/lib/mind/branches";
import { recordCommit } from "@/lib/mind/commits";
import type { LinkChange } from "@/lib/mind/types";


const MAX_TITLE_CHARS = 80;
const MAX_TRANSCRIPT_CHARS = 400_000;
const TRIMMED_NOTE = "_(earlier turns trimmed to fit the memory size limit)_";

const ROLE_LABEL: Record<string, string> = {
  user: "You",
  assistant: "Assistant",
};

export type TranscriptTurn = { role: string; content: string };

export function conversationMemoryTitle(conversationTitle: string): string {
  const title = conversationTitle.replace(/\s+/g, " ").trim() || "Untitled conversation";
  return `Chat: ${title}`.slice(0, MAX_TITLE_CHARS);
}

export function conversationMemoryContent(conversationTitle: string, turns: TranscriptTurn[]): string {
  const header = `# ${conversationMemoryTitle(conversationTitle)}`;
  const blocks = turns
    .filter((t) => (t.role === "user" || t.role === "assistant") && t.content.trim().length > 0)
    .map((t) => `**${ROLE_LABEL[t.role]}:**\n${t.content.trim()}`);

  const budget = MAX_TRANSCRIPT_CHARS - header.length - TRIMMED_NOTE.length;
  const kept: string[] = [];
  let used = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const cost = blocks[i].length + 2;
    if (used + cost > budget) break;
    kept.unshift(blocks[i]);
    used += cost;
  }
  if (kept.length === 0 && blocks.length > 0) {
    kept.push(blocks[blocks.length - 1].slice(0, budget));
  }

  const trimmed = kept.length < blocks.length;
  return [header, ...(trimmed ? [TRIMMED_NOTE] : []), ...kept].join("\n\n");
}

export async function syncConversationMemory(
  db: SupabaseClient,
  identity: ApiIdentity,
  conversation: { id: string; title: string; memoryId: string | null },
  turns: TranscriptTurn[]
): Promise<string> {
  const title = conversationMemoryTitle(conversation.title);
  const content = conversationMemoryContent(conversation.title, turns);
  const summary = summarize(
    turns
      .filter((t) => t.role === "user" || t.role === "assistant")
      .map((t) => t.content.trim())
      .join(" ")
  );
  const tags = autoTags(content, title);

  const branch = await ensureMainBranch(db, identity.userId);
  const isNew = !conversation.memoryId;
  const memoryId = conversation.memoryId ?? crypto.randomUUID();

  let linkChanges: LinkChange[] = [];
  if (isNew) {
    try {
      linkChanges = await suggestLinkChangesForMemory(db, identity.userId, branch, {
        id: memoryId,
        title,
        summary,
        tags,
      });
    } catch {
    }
  }

  await recordCommit(
    db,
    identity,
    branch.id,
    `chat: ${conversation.title.slice(0, 60)}`,
    [{ memory_id: memoryId, op: isNew ? "create" : "update", title, content, summary, tags, source: "chat" }],
    linkChanges,
    { authorKind: "system" }
  );

  if (isNew) {
    await db.from("conversations").update({ memory_id: memoryId }).eq("id", conversation.id);
    try {
      await syncArtifactLinksForMemory(db, identity.userId, { id: memoryId, title, summary, tags });
    } catch {
    }
  }
  await embedMemoryBestEffort(db, identity.userId, memoryId, `${title}\n${content}`);

  return memoryId;
}
