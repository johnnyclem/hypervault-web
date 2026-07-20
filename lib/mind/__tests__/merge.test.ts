import { describe, expect, it } from "vitest";
import { applyResolutions, findMergeBase, mergeLinkSets, threeWayMerge } from "../merge";
import type { CommitRow, LinkState, MemorySnapshot, MemoryState } from "../types";
import { linkKey } from "../types";

function commit(id: string, parent: string | null = null, mergeParent: string | null = null): CommitRow {
  return { id, parent_commit_id: parent, merge_parent_commit_id: mergeParent };
}

function snap(id: string, content: string, title = `title-${id}`, tags: string[] = []): MemorySnapshot {
  return { memory_id: id, title, content, summary: content.slice(0, 40), tags, source: "manual" };
}

function state(...snaps: MemorySnapshot[]): MemoryState {
  return new Map(snaps.map((s) => [s.memory_id, s]));
}

const summarize = (content: string) => content.slice(0, 40);

describe("findMergeBase", () => {
  it("finds the fork point on a simple branch", () => {
    const commits = [commit("c1"), commit("c2", "c1"), commit("c3", "c2"), commit("c4", "c2")];
    expect(findMergeBase(commits, "c3", "c4")).toBe("c2");
  });

  it("handles linear ancestry (one side is an ancestor of the other)", () => {
    const commits = [commit("c1"), commit("c2", "c1"), commit("c3", "c2")];
    expect(findMergeBase(commits, "c3", "c2")).toBe("c2");
    expect(findMergeBase(commits, "c2", "c3")).toBe("c2");
  });

  it("follows merge parents for a second merge after a first", () => {
    const commits = [
      commit("c1"),
      commit("c2", "c1"),
      commit("c4", "c1"),
      commit("m1", "c2", "c4"),
      commit("c5", "c4"),
    ];
    expect(findMergeBase(commits, "m1", "c5")).toBe("c4");
  });

  it("returns null when histories are unrelated", () => {
    const commits = [commit("a1"), commit("b1")];
    expect(findMergeBase(commits, "a1", "b1")).toBeNull();
  });
});

describe("threeWayMerge", () => {
  it("auto-takes theirs when only theirs changed", () => {
    const base = state(snap("m1", "old"));
    const ours = state(snap("m1", "old"));
    const theirs = state(snap("m1", "new"));
    const { changes, conflicts } = threeWayMerge(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ memory_id: "m1", op: "update", content: "new" });
  });

  it("keeps ours when only ours changed (no change emitted)", () => {
    const base = state(snap("m1", "old"));
    const ours = state(snap("m1", "mine"));
    const theirs = state(snap("m1", "old"));
    const { changes, conflicts } = threeWayMerge(base, ours, theirs);
    expect(changes).toEqual([]);
    expect(conflicts).toEqual([]);
  });

  it("is quiet when both sides made the identical change", () => {
    const base = state(snap("m1", "old"));
    const ours = state(snap("m1", "same"));
    const theirs = state(snap("m1", "same"));
    const { changes, conflicts } = threeWayMerge(base, ours, theirs);
    expect(changes).toEqual([]);
    expect(conflicts).toEqual([]);
  });

  it("creates memories added on theirs", () => {
    const base = state();
    const ours = state();
    const theirs = state(snap("m2", "branch-born"));
    const { changes, conflicts } = threeWayMerge(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(changes[0]).toMatchObject({ memory_id: "m2", op: "create" });
  });

  it("deletes memories theirs forgot when ours didn't touch them", () => {
    const base = state(snap("m1", "old"));
    const ours = state(snap("m1", "old"));
    const theirs = state();
    const { changes, conflicts } = threeWayMerge(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(changes[0]).toMatchObject({ memory_id: "m1", op: "delete" });
  });

  it("conflicts when both sides diverged", () => {
    const base = state(snap("m1", "old"));
    const ours = state(snap("m1", "mine"));
    const theirs = state(snap("m1", "yours"));
    const { changes, conflicts } = threeWayMerge(base, ours, theirs);
    expect(changes).toEqual([]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ memory_id: "m1" });
    expect(conflicts[0].ours?.content).toBe("mine");
    expect(conflicts[0].theirs?.content).toBe("yours");
  });

  it("conflicts on delete-vs-edit", () => {
    const base = state(snap("m1", "old"));
    const ours = state(snap("m1", "edited"));
    const theirs = state();
    const { conflicts } = threeWayMerge(base, ours, theirs);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].theirs).toBeUndefined();
  });

  it("treats tag order as irrelevant", () => {
    const base = state(snap("m1", "x", "t", ["a", "b"]));
    const ours = state(snap("m1", "x", "t", ["b", "a"]));
    const theirs = state(snap("m1", "x", "t", ["a", "b"]));
    const { changes, conflicts } = threeWayMerge(base, ours, theirs);
    expect(changes).toEqual([]);
    expect(conflicts).toEqual([]);
  });
});

describe("applyResolutions", () => {
  const base = state(snap("m1", "old"));
  const ours = state(snap("m1", "mine"));
  const theirs = state(snap("m1", "yours"));

  it('"ours" drops the conflict without a change', () => {
    const outcome = applyResolutions(
      threeWayMerge(base, ours, theirs),
      [{ memory_id: "m1", resolution: "ours" }],
      summarize
    );
    expect(outcome.conflicts).toEqual([]);
    expect(outcome.changes).toEqual([]);
  });

  it('"theirs" takes their side as an update', () => {
    const outcome = applyResolutions(
      threeWayMerge(base, ours, theirs),
      [{ memory_id: "m1", resolution: "theirs" }],
      summarize
    );
    expect(outcome.conflicts).toEqual([]);
    expect(outcome.changes[0]).toMatchObject({ memory_id: "m1", op: "update", content: "yours" });
  });

  it("explicit fields commit a hand-merged snapshot with a fresh summary", () => {
    const outcome = applyResolutions(
      threeWayMerge(base, ours, theirs),
      [{ memory_id: "m1", resolution: { title: "merged", content: "both, reconciled" } }],
      summarize
    );
    expect(outcome.conflicts).toEqual([]);
    expect(outcome.changes[0]).toMatchObject({
      memory_id: "m1",
      op: "update",
      title: "merged",
      content: "both, reconciled",
      summary: "both, reconciled",
    });
  });

  it("leaves unresolved conflicts in place", () => {
    const outcome = applyResolutions(threeWayMerge(base, ours, theirs), [], summarize);
    expect(outcome.conflicts).toHaveLength(1);
  });
});

describe("mergeLinkSets", () => {
  const key = linkKey("a", "b");

  function links(entries: [string, "manual" | "auto"][]): LinkState {
    return new Map(entries);
  }

  it("adds links either side added", () => {
    const changes = mergeLinkSets(links([]), links([]), links([[key, "auto"]]));
    expect(changes).toEqual([{ a_id: "a", b_id: "b", op: "add", kind: "auto" }]);
  });

  it("removes links one side removed", () => {
    const changes = mergeLinkSets(links([[key, "auto"]]), links([[key, "auto"]]), links([]));
    expect(changes).toEqual([{ a_id: "a", b_id: "b", op: "remove", kind: "auto" }]);
  });

  it("keeps a link removed on one side but re-added identically on both", () => {
    const changes = mergeLinkSets(links([[key, "auto"]]), links([[key, "auto"]]), links([[key, "auto"]]));
    expect(changes).toEqual([]);
  });

  it("never downgrades a manual link to auto", () => {
    const changes = mergeLinkSets(links([]), links([]), links([[key, "manual"]]));
    expect(changes[0].kind).toBe("manual");
  });
});
