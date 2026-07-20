import { describe, expect, it } from "vitest";
import {
  avError,
  buildConceptKey,
  conceptIdToMemoryId,
  memoryToEntries,
  parseConceptKey,
} from "@/lib/polytician/bridge";
import type { StateRow } from "@/lib/mind/state";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function stateRow(over: Partial<StateRow> = {}): StateRow {
  return {
    memory_id: "11111111-1111-1111-1111-111111111111",
    title: "Title",
    content: "# Title\n\nbody",
    summary: "body",
    tags: ["alpha"],
    source: "agent",
    revision_id: "rev-1",
    commit_id: "commit-1",
    committed_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("concept key parsing", () => {
  it("round-trips build → parse for both representations", () => {
    for (const rep of ["markdown", "thoughtform"] as const) {
      const key = buildConceptKey("abc-123", rep);
      expect(key).toBe(`concepts/abc-123/${rep}`);
      expect(parseConceptKey(key)).toEqual({ conceptId: "abc-123", representation: rep });
    }
  });

  it("rejects keys that aren't concept representations", () => {
    expect(parseConceptKey("concepts/abc")).toBeNull();
    expect(parseConceptKey("concepts/abc/vector")).toBeNull();
    expect(parseConceptKey("other/abc/markdown")).toBeNull();
    expect(parseConceptKey("")).toBeNull();
  });
});

describe("conceptIdToMemoryId", () => {
  it("passes a uuid through unchanged (lowercased)", () => {
    const id = "8F2C0A1B-1234-4321-ABCD-0123456789AB";
    expect(conceptIdToMemoryId(id)).toBe(id.toLowerCase());
  });

  it("maps a non-uuid id to a deterministic, valid uuid", () => {
    const a = conceptIdToMemoryId("my-concept");
    const b = conceptIdToMemoryId("my-concept");
    const c = conceptIdToMemoryId("other-concept");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(UUID_RE);
    expect(c).toMatch(UUID_RE);
  });
});

describe("memoryToEntries", () => {
  it("emits a markdown entry only when no ThoughtForm is stored", () => {
    const entries = memoryToEntries(stateRow(), null);
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe("concepts/11111111-1111-1111-1111-111111111111/markdown");
    expect(entries[0].contentType).toBe("markdown");
    expect(entries[0].data).toBe("# Title\n\nbody");
    expect(entries[0].metadata.updatedAt).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });

  it("adds a thoughtform entry and prefers the stored concept id + clock", () => {
    const entries = memoryToEntries(stateRow(), {
      memory_id: "11111111-1111-1111-1111-111111111111",
      concept_id: "concept-verbatim",
      namespace: "notes",
      version: 3,
      thoughtform: { schemaVersion: "1.0", entities: [] },
      updated_at_ms: 1709555555000,
    });
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.contentType)).toEqual(["markdown", "json"]);
    expect(entries[0].key).toBe("concepts/concept-verbatim/markdown");
    expect(entries[1].key).toBe("concepts/concept-verbatim/thoughtform");
    expect(JSON.parse(entries[1].data)).toEqual({ schemaVersion: "1.0", entities: [] });
    for (const e of entries) {
      expect(e.metadata).toMatchObject({ conceptId: "concept-verbatim", namespace: "notes", version: 3, updatedAt: 1709555555000 });
    }
  });
});

describe("avError", () => {
  it("returns a non-2xx JSON body and never a success flag", async () => {
    const res = avError(413, "TOO_MANY_ENTRIES", "too many");
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body).toEqual({ error: "too many", code: "TOO_MANY_ENTRIES" });
    expect(body).not.toHaveProperty("success");
  });
});
