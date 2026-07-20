import { describe, expect, it } from "vitest";
import { chunkImportPayload } from "@/lib/imports/chunk";

function grokConvo(id: string, textLength: number) {
  return {
    conversation_id: id,
    title: `convo ${id}`,
    responses: [{ sender: "human", message: "x".repeat(textLength) }],
  };
}

describe("chunkImportPayload", () => {
  it("leaves small payloads untouched", () => {
    const raw = JSON.stringify([grokConvo("1", 10), grokConvo("2", 10)]);
    expect(chunkImportPayload(raw, 3_500_000)).toEqual([raw]);
  });

  it("leaves non-JSON payloads (pasted transcripts) untouched", () => {
    const raw = "User: hi\nAssistant: hello".repeat(200_000);
    expect(chunkImportPayload(raw, 1000)).toEqual([raw]);
  });

  it("splits a large array of conversations into sub-limit batches", () => {
    const conversations = Array.from({ length: 20 }, (_, i) => grokConvo(String(i), 50_000));
    const raw = JSON.stringify(conversations);
    const maxBytes = 200_000;
    const chunks = chunkImportPayload(raw, maxBytes);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(maxBytes);
    }

    const total = chunks.flatMap((c) => JSON.parse(c));
    expect(total).toHaveLength(20);
    expect(total.map((c: { conversation_id: string }) => c.conversation_id).sort()).toEqual(
      conversations.map((c) => c.conversation_id).sort()
    );
  });

  it("unwraps a { conversations: [...] } wrapper before chunking", () => {
    const conversations = Array.from({ length: 10 }, (_, i) => grokConvo(String(i), 50_000));
    const raw = JSON.stringify({ conversations });
    const chunks = chunkImportPayload(raw, 200_000);

    expect(chunks.length).toBeGreaterThan(1);
    const total = chunks.flatMap((c) => JSON.parse(c));
    expect(total).toHaveLength(10);
  });

  it("keeps a single oversized conversation as its own chunk", () => {
    const raw = JSON.stringify([grokConvo("only", 500_000)]);
    expect(chunkImportPayload(raw, 200_000)).toEqual([raw]);
  });
});
