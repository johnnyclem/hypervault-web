import { appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";


export type TranscriptTurn = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
};

function turnId(conversationId: string, role: string, content: string, index: number): string {
  const digest = createHash("sha256")
    .update(`${conversationId}\n${role}\n${content}\n${index}`)
    .digest("hex")
    .slice(0, 16);
  return `msg_${digest}`;
}

export function toJsonlTurns(
  conversationId: string,
  turns: TranscriptTurn[],
  timestamp: Date = new Date()
): string {
  return turns
    .map((turn, i) => {
      const line = {
        id: turnId(conversationId, turn.role, turn.content, i),
        role: turn.role,
        content: turn.content,
        timestamp: new Date(timestamp.getTime() + i).toISOString(),
        sessionId: conversationId,
      };
      return `${JSON.stringify(line)}\n`;
    })
    .join("");
}

export async function appendTranscript(
  conversationId: string,
  turns: TranscriptTurn[]
): Promise<void> {
  const path = process.env.STENOGRAPHER_LOG_PATH?.trim();
  if (!path || turns.length === 0) return;
  try {
    await appendFile(path, toJsonlTurns(conversationId, turns), "utf8");
  } catch {
  }
}
