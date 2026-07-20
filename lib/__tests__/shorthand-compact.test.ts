import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanonicalMessage } from "@/lib/chat/canonical";
import {
  compactChatHistory,
  COMPACT_BUDGET_TOKENS,
  KEEP_RAW_TURNS,
  MIN_MESSAGES_TO_COMPACT,
} from "@/lib/shorthand/compact";
import { CompactionEngine } from "@/lib/vendor/short-hand/compaction/compaction-engine";

function turn(role: "user" | "assistant", content: string): CanonicalMessage {
  return { role, content, attachments: [] };
}

function thread(length: number): CanonicalMessage[] {
  return Array.from({ length }, (_, i) =>
    turn(i % 2 === 0 ? "user" : "assistant", `Message number ${i}: we discussed topic ${i % 7} in detail.`)
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("compactChatHistory", () => {
  it("skips short threads — raw history is already cheap", async () => {
    expect(await compactChatHistory(thread(MIN_MESSAGES_TO_COMPACT - 1))).toBeNull();
    expect(await compactChatHistory([])).toBeNull();
  });

  it("keeps the most recent turns verbatim and summarizes the rest", async () => {
    const canonical = thread(40);
    const result = await compactChatHistory(canonical);
    expect(result).not.toBeNull();
    expect(result!.keptMessages).toEqual(canonical.slice(-KEEP_RAW_TURNS));
    expect(result!.contextBlock).toContain("## Conversation so far (compacted)");
  });

  it("preserves decisions from the compacted-away turns", async () => {
    const canonical = thread(40);
    canonical[3] = turn("user", "We decided on aardvark-7 as the launch phrase.");
    const result = await compactChatHistory(canonical);
    expect(result!.contextBlock).toContain("aardvark-7");
  });

  it("stays near the token budget", async () => {
    const canonical = thread(400);
    const result = await compactChatHistory(canonical);
    expect(result!.contextBlock.length).toBeLessThan(COMPACT_BUDGET_TOKENS * 6);
  });

  it("folds attachment text into what gets compacted", async () => {
    const canonical = thread(40);
    canonical[2] = {
      role: "user",
      content: "See the attached spec.",
      attachments: [{ name: "spec.txt", extracted_text: "We chose quokka-9 for the cipher suite." }],
    };
    const result = await compactChatHistory(canonical);
    expect(result!.contextBlock).toContain("quokka-9");
  });

  it("returns null instead of throwing when the engine fails", async () => {
    vi.spyOn(CompactionEngine.prototype, "addMessages").mockRejectedValue(new Error("boom"));
    expect(await compactChatHistory(thread(40))).toBeNull();
  });
});
