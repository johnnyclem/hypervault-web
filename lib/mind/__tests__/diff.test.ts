import { describe, expect, it } from "vitest";
import { diffLinks, diffMemoryText, diffStates } from "../diff";
import type { LinkState, MemorySnapshot, MemoryState } from "../types";
import { linkKey } from "../types";

function snap(id: string, content: string, title = `title-${id}`, tags: string[] = []): MemorySnapshot {
  return { memory_id: id, title, content, summary: "", tags, source: "manual" };
}

function state(...snaps: MemorySnapshot[]): MemoryState {
  return new Map(snaps.map((s) => [s.memory_id, s]));
}

describe("diffMemoryText", () => {
  it("returns no hunks for identical content", () => {
    expect(diffMemoryText("same\ntext", "same\ntext")).toEqual({ hunks: [], oversize: false });
  });

  it("produces add/del lines for a changed line", () => {
    const diff = diffMemoryText("keep\nold line\nkeep2", "keep\nnew line\nkeep2");
    expect(diff.oversize).toBe(false);
    expect(diff.hunks).toHaveLength(1);
    const kinds = diff.hunks[0].lines.map((l) => `${l.kind}:${l.text}`);
    expect(kinds).toContain("del:old line");
    expect(kinds).toContain("add:new line");
    expect(kinds).toContain("ctx:keep");
  });

  it("flags oversize inputs instead of hunking them", () => {
    const big = "x".repeat(250_000);
    const diff = diffMemoryText(big, `${big}y`);
    expect(diff.oversize).toBe(true);
    expect(diff.hunks).toEqual([]);
  });
});

describe("diffStates", () => {
  it("classifies added, removed, and changed memories", () => {
    const before = state(snap("kept", "same"), snap("gone", "bye"), snap("edited", "v1"));
    const after = state(snap("kept", "same"), snap("edited", "v2"), snap("fresh", "hi"));
    const diff = diffStates(before, after);
    expect(diff.added.map((m) => m.memory_id)).toEqual(["fresh"]);
    expect(diff.removed.map((m) => m.memory_id)).toEqual(["gone"]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]).toMatchObject({ memory_id: "edited", content_changed: true });
    expect(diff.changed[0].diff.hunks.length).toBeGreaterThan(0);
  });

  it("reports tag and title changes without content hunks", () => {
    const before = state(snap("m", "same", "Old title", ["a"]));
    const after = state(snap("m", "same", "New title", ["b"]));
    const diff = diffStates(before, after);
    expect(diff.changed[0]).toMatchObject({
      title_from: "Old title",
      title_to: "New title",
      tags_added: ["b"],
      tags_removed: ["a"],
      content_changed: false,
    });
    expect(diff.changed[0].diff.hunks).toEqual([]);
  });

  it("skips untouched memories entirely", () => {
    const s = state(snap("m", "same"));
    const diff = diffStates(s, state(snap("m", "same")));
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });
});

describe("diffLinks", () => {
  it("splits normalized keys back into pairs", () => {
    const from: LinkState = new Map([[linkKey("b", "a"), "auto"]]);
    const to: LinkState = new Map([[linkKey("c", "d"), "manual"]]);
    const diff = diffLinks(from, to);
    expect(diff.removed).toEqual([{ a_id: "a", b_id: "b", kind: "auto" }]);
    expect(diff.added).toEqual([{ a_id: "c", b_id: "d", kind: "manual" }]);
  });
});
