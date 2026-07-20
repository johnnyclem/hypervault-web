import { describe, expect, it } from "vitest";
import {
  isThoughtFormV1,
  memoryToThoughtForm,
  thoughtFormToMemory,
  type ThoughtFormV1,
} from "@/lib/polytician/thoughtform";
import { looksLikePolyticianExport, parsePolyticianExport } from "@/lib/polytician/import";

describe("memoryToThoughtForm", () => {
  it("builds entities from tags + links and relationships from links", () => {
    const tf = memoryToThoughtForm(
      { id: "m1", title: "Postgres choice", content: "We chose Postgres.", summary: "chose Postgres", tags: ["db", "decision"] },
      ["Mongo evaluation"],
      { createdAtMs: 1000, updatedAtMs: 2000 }
    );
    expect(tf.schemaVersion).toBe("1.0");
    expect(tf.id).toBe("m1");
    expect(tf.metadata.source).toBe("hypervault");
    expect(tf.metadata.contentHash).toHaveLength(64);
    expect(tf.metadata.createdAtMs).toBe(1000);
    expect(tf.metadata.updatedAtMs).toBe(2000);
    expect(tf.entities.filter((e) => e.type === "tag").map((e) => e.value)).toEqual(["db", "decision"]);
    expect(tf.entities.some((e) => e.type === "memory" && e.value === "Mongo evaluation")).toBe(true);
    expect(tf.relationships[0].type).toBe("related_to");
    expect(isThoughtFormV1(tf)).toBe(true);
  });
});

describe("thoughtFormToMemory", () => {
  it("round-trips content and recovers tag entities", () => {
    const tf = memoryToThoughtForm(
      { id: "m1", title: "Title line", content: "# Title line\n\nbody text here", summary: "body", tags: ["alpha"] },
      []
    );
    const memory = thoughtFormToMemory(tf);
    expect(memory.content).toBe("# Title line\n\nbody text here");
    expect(memory.title).toBe("Title line");
    expect(memory.tags).toContain("alpha");
  });

  it("renders entities/relationships when a ThoughtForm has no raw content", () => {
    const tf: ThoughtFormV1 = {
      schemaVersion: "1.0",
      id: "x",
      metadata: { createdAtMs: 0, updatedAtMs: 0, source: "polytician", contentHash: "abc123abc123abc1" },
      entities: [{ id: "e1", type: "person", value: "Ada" }],
      relationships: [{ id: "r1", type: "knows", from: "e1", to: "e1" }],
      context: {},
      extensions: {},
    };
    const memory = thoughtFormToMemory(tf);
    expect(memory.content).toContain("Ada");
  });

  it("preserves unknown passthrough fields on the ThoughtForm object", () => {
    const tf = memoryToThoughtForm({ id: "m", title: "t", content: "c", summary: "c", tags: [] }, []);
    (tf as Record<string, unknown>).customField = { keep: true };
    const round = JSON.parse(JSON.stringify(tf)) as Record<string, unknown>;
    expect(round.customField).toEqual({ keep: true });
  });
});

describe("looksLikePolyticianExport + parsePolyticianExport", () => {
  it("detects and parses a { concepts: [...] } bundle with mixed shapes", () => {
    const bundle = {
      concepts: [
        { id: "c1", namespace: "notes", version: 2, markdown: "# One\n\nfirst", tags: ["a"] },
        { id: "c2", representations: { md: "# Two\n\nsecond" } },
        { id: "c3", thoughtform: { schemaVersion: "1.0", id: "c3", metadata: { createdAtMs: 0, updatedAtMs: 5, source: "polytician", contentHash: "x".repeat(16) }, content: "# Three\n\nthird", entities: [], relationships: [], context: {}, extensions: {} } },
      ],
    };
    expect(looksLikePolyticianExport(bundle)).toBe(true);
    const parsed = parsePolyticianExport(bundle);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({ conceptId: "c1", namespace: "notes", version: 2 });
    expect(parsed[0].content).toContain("first");
    expect(parsed[1].content).toContain("second");
    expect(parsed[2].content).toContain("third");
    expect(parsed[2].thoughtform).toBeDefined();
    expect(parsed[2].updatedAtMs).toBe(5);
  });

  it("accepts a bare array of concepts and drops empty ones", () => {
    const arr = [
      { id: "a", markdown: "content a" },
      { id: "b" },
    ];
    expect(looksLikePolyticianExport(arr)).toBe(true);
    expect(parsePolyticianExport(arr)).toHaveLength(1);
  });

  it("rejects non-exports", () => {
    expect(looksLikePolyticianExport({ url: "https://example.com" })).toBe(false);
    expect(looksLikePolyticianExport([])).toBe(false);
    expect(looksLikePolyticianExport("nope")).toBe(false);
  });
});
