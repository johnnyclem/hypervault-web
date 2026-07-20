import { describe, expect, it } from "vitest";
import { firstParentChain, replayLinks, replayState } from "../state";
import type { CommitRow, LinkChangeRow, RevisionRow } from "../types";
import { linkKey } from "../types";

function commit(id: string, parent: string | null = null, mergeParent: string | null = null): CommitRow {
  return { id, parent_commit_id: parent, merge_parent_commit_id: mergeParent };
}

function rev(commitId: string, memoryId: string, op: RevisionRow["op"], content: string): RevisionRow {
  return {
    id: `rev-${commitId}-${memoryId}`,
    commit_id: commitId,
    memory_id: memoryId,
    op,
    title: `title-${memoryId}`,
    content,
    summary: "",
    tags: [],
    source: "manual",
  };
}

describe("firstParentChain", () => {
  it("walks parents from the tip and ignores merge parents", () => {
    const commits = [commit("c1"), commit("c2", "c1"), commit("b1", "c1"), commit("m1", "c2", "b1")];
    expect(firstParentChain(commits, "m1")).toEqual(["m1", "c2", "c1"]);
  });
});

describe("replayState", () => {
  it("replays create → update → delete", () => {
    const commits = [commit("c1"), commit("c2", "c1"), commit("c3", "c2")];
    const revisions = [rev("c1", "m1", "create", "v1"), rev("c2", "m1", "update", "v2"), rev("c3", "m1", "delete", "v2")];

    expect(replayState(commits, revisions, "c1").get("m1")?.content).toBe("v1");
    expect(replayState(commits, revisions, "c2").get("m1")?.content).toBe("v2");
    expect(replayState(commits, revisions, "c3").has("m1")).toBe(false);
  });

  it("a restore commit after a delete brings the memory back", () => {
    const commits = [commit("c1"), commit("c2", "c1"), commit("c3", "c2")];
    const revisions = [
      rev("c1", "m1", "create", "v1"),
      rev("c2", "m1", "delete", "v1"),
      rev("c3", "m1", "create", "v1"),
    ];
    expect(replayState(commits, revisions, "c2").has("m1")).toBe(false);
    expect(replayState(commits, revisions, "c3").get("m1")?.content).toBe("v1");
  });

  it("branch state at a fork point sees the source branch's revisions", () => {
    const commits = [commit("c1"), commit("c2", "c1"), commit("b1", "c2")];
    const revisions = [rev("c1", "m1", "create", "v1"), rev("c2", "m1", "update", "v2"), rev("b1", "m2", "create", "branchy")];

    const branchTip = replayState(commits, revisions, "b1");
    expect(branchTip.get("m1")?.content).toBe("v2");
    expect(branchTip.get("m2")?.content).toBe("branchy");

    expect(replayState(commits, revisions, "c2").has("m2")).toBe(false);
  });

  it("merge commits materialize theirs so first-parent replay is exact", () => {
    const commits = [commit("c1"), commit("b1", "c1"), commit("m1", "c1", "b1")];
    const revisions = [
      rev("c1", "m1-mem", "create", "main-born"),
      rev("b1", "m2", "create", "branch-born"),
      rev("m1", "m2", "create", "branch-born"),
    ];
    const merged = replayState(commits, revisions, "m1");
    expect(merged.get("m1-mem")?.content).toBe("main-born");
    expect(merged.get("m2")?.content).toBe("branch-born");
  });

  it("the nearest revision wins when a memory changed twice", () => {
    const commits = [commit("c1"), commit("c2", "c1"), commit("c3", "c2")];
    const revisions = [rev("c1", "m1", "create", "v1"), rev("c3", "m1", "update", "v3")];
    expect(replayState(commits, revisions, "c3").get("m1")?.content).toBe("v3");
  });
});

describe("replayLinks", () => {
  function change(commitId: string, a: string, b: string, op: "add" | "remove"): LinkChangeRow {
    return { commit_id: commitId, a_id: a, b_id: b, op, kind: "auto" };
  }

  it("folds add/remove with nearest-wins semantics", () => {
    const commits = [commit("c1"), commit("c2", "c1"), commit("c3", "c2")];
    const changes = [change("c1", "a", "b", "add"), change("c2", "a", "b", "remove"), change("c3", "a", "b", "add")];

    expect(replayLinks(commits, changes, "c1").has(linkKey("a", "b"))).toBe(true);
    expect(replayLinks(commits, changes, "c2").has(linkKey("a", "b"))).toBe(false);
    expect(replayLinks(commits, changes, "c3").has(linkKey("a", "b"))).toBe(true);
  });
});
