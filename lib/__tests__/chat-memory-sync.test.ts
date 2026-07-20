import { describe, expect, it } from "vitest";
import {
  conversationMemoryContent,
  conversationMemoryTitle,
  type TranscriptTurn,
} from "@/lib/chat/memory-sync";
import { parseVisibility, sharePath } from "@/lib/chat/visibility";

describe("conversationMemoryTitle", () => {
  it("prefixes the conversation title so chats are recognizable in the wiki", () => {
    expect(conversationMemoryTitle("Trip planning")).toBe("Chat: Trip planning");
  });

  it("collapses whitespace and falls back for empty titles", () => {
    expect(conversationMemoryTitle("  spaced \n out  ")).toBe("Chat: spaced out");
    expect(conversationMemoryTitle("   ")).toBe("Chat: Untitled conversation");
  });

  it("caps runaway titles at 80 chars", () => {
    expect(conversationMemoryTitle("x".repeat(300)).length).toBe(80);
  });
});

describe("conversationMemoryContent", () => {
  const turns: TranscriptTurn[] = [
    { role: "user", content: "What is the capital of France?" },
    { role: "assistant", content: "Paris." },
  ];

  it("renders a labeled markdown transcript under a title header", () => {
    const content = conversationMemoryContent("Geography", turns);
    expect(content).toBe(
      "# Chat: Geography\n\n**You:**\nWhat is the capital of France?\n\n**Assistant:**\nParis."
    );
  });

  it("skips system/tool turns and empty messages", () => {
    const content = conversationMemoryContent("Geography", [
      { role: "system", content: "You are helpful." },
      { role: "tool", content: "{}" },
      { role: "assistant", content: "   " },
      ...turns,
    ]);
    expect(content).not.toContain("You are helpful.");
    expect(content).not.toContain("{}");
    expect(content).toContain("Paris.");
  });

  it("drops the oldest turns first when the thread outgrows the cap", () => {
    const big = "a".repeat(150_000);
    const content = conversationMemoryContent("Long", [
      { role: "user", content: `first ${big}` },
      { role: "assistant", content: `second ${big}` },
      { role: "user", content: `third ${big}` },
    ]);
    expect(content.length).toBeLessThanOrEqual(400_000);
    expect(content).toContain("earlier turns trimmed");
    expect(content).not.toContain("first");
    expect(content).toContain("second");
    expect(content).toContain("third");
  });

  it("hard-cuts a single turn bigger than the whole budget", () => {
    const content = conversationMemoryContent("Huge", [
      { role: "user", content: "b".repeat(500_000) },
    ]);
    expect(content.length).toBeLessThanOrEqual(400_000);
    expect(content).toContain("bbb");
  });
});

describe("parseVisibility", () => {
  it("accepts exactly the three visibility states", () => {
    expect(parseVisibility("private")).toBe("private");
    expect(parseVisibility("shared")).toBe("shared");
    expect(parseVisibility("public")).toBe("public");
  });

  it("rejects everything else — chats can never drift out of private by accident", () => {
    expect(parseVisibility("PUBLIC")).toBeNull();
    expect(parseVisibility("")).toBeNull();
    expect(parseVisibility(undefined)).toBeNull();
    expect(parseVisibility(42)).toBeNull();
    expect(parseVisibility("friends")).toBeNull();
  });
});

describe("sharePath", () => {
  it("routes share links under /c/", () => {
    expect(sharePath("trip-planning-abc123")).toBe("/c/trip-planning-abc123");
  });
});
