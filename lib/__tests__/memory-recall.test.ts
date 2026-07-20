import { describe, expect, it, vi } from "vitest";
import { branchRecallMemories, fuseRecallRankings } from "@/lib/memory-recall";

describe("fuseRecallRankings", () => {
  it("ranks items found by both signals above single-signal items", () => {
    const lexScored = [
      { id: "both", score: 5 },
      { id: "lex-only", score: 3 },
      { id: "unmatched", score: 0 },
    ];
    const semanticRank = new Map([
      ["both", 0],
      ["sem-only", 1],
    ]);

    const fused = fuseRecallRankings(lexScored, semanticRank);
    expect(fused.get("both")!).toBeGreaterThan(fused.get("lex-only")!);
    expect(fused.get("both")!).toBeGreaterThan(fused.get("sem-only")!);
  });

  it("lets semantic-only neighbors surface even with zero keyword overlap", () => {
    const lexScored = [{ id: "unmatched", score: 0 }];
    const semanticRank = new Map([["sem-only", 0]]);

    const fused = fuseRecallRankings(lexScored, semanticRank);
    expect(fused.get("sem-only")!).toBeGreaterThan(0);
    expect(fused.get("unmatched")).toBe(0);
  });

  it("preserves lexical order among lexical-only results", () => {
    const lexScored = [
      { id: "first", score: 9 },
      { id: "second", score: 4 },
      { id: "third", score: 1 },
    ];
    const fused = fuseRecallRankings(lexScored, new Map());
    expect(fused.get("first")!).toBeGreaterThan(fused.get("second")!);
    expect(fused.get("second")!).toBeGreaterThan(fused.get("third")!);
  });

  it("weights earlier semantic ranks higher", () => {
    const fused = fuseRecallRankings(
      [],
      new Map([
        ["near", 0],
        ["far", 10],
      ])
    );
    expect(fused.get("near")!).toBeGreaterThan(fused.get("far")!);
  });
});

describe("branchRecallMemories", () => {
  const stateRow = (id: string, title: string, summary = "") => ({
    memory_id: id,
    revision_id: `rev-${id}`,
    title,
    content: "",
    summary,
    tags: [] as string[],
    source: "chat",
    commit_id: `c-${id}`,
    committed_at: "2026-01-01T00:00:00Z",
  });

  const rows = [
    stateRow("a", "School lunches plan", "who packs the school lunches"),
    stateRow("b", "Weekend errands", "grocery run and laundry"),
  ];

  function mockDb(ftsHitIds: string[]) {
    return {
      rpc: vi.fn(async (_fn: string, params: { p_q: string | null }) => ({
        data: params.p_q ? rows.filter((r) => ftsHitIds.includes(r.memory_id)) : rows,
        error: null,
      })),
    } as never;
  }

  it("ranks a branch's head revisions lexically, FTS hits first", async () => {
    const { mode, ranked } = await branchRecallMemories(
      mockDb(["a"]),
      "user-1",
      "branch-1",
      "school lunches",
      4
    );
    expect(mode).toBe("lexical");
    expect(ranked[0].memory.id).toBe("a");
    expect(ranked.map((r) => r.memory.id)).not.toContain("b");
  });

  it("returns nothing when the query matches no branch memory", async () => {
    const { ranked } = await branchRecallMemories(
      mockDb([]),
      "user-1",
      "branch-1",
      "zebra xylophone",
      4
    );
    expect(ranked).toEqual([]);
  });
});
