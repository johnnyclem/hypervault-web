import { describe, expect, it } from "vitest";
import {
  autoTags,
  autoTitle,
  MAX_SUMMARY_CHARS,
  memoryArtifactAffinity,
  memoryKeywords,
  scoreRecall,
  suggestArtifactLinks,
  suggestMemoriesForArtifact,
  suggestMemoryLinks,
  summarize,
  toLinkChanges,
} from "../memory";

describe("toLinkChanges", () => {
  it("normalizes pairs (a_id < b_id), dedupes, and drops self-links", () => {
    const changes = toLinkChanges("m", ["z", "a", "z", "m", ""], "auto");
    expect(changes).toEqual([
      { a_id: "m", b_id: "z", op: "add", kind: "auto" },
      { a_id: "a", b_id: "m", op: "add", kind: "auto" },
    ]);
  });

  it("carries the kind through", () => {
    expect(toLinkChanges("m", ["x"], "manual")[0].kind).toBe("manual");
  });
});

describe("memoryKeywords", () => {
  it("drops stopwords and short tokens", () => {
    expect(memoryKeywords("I was thinking about the Rust borrow checker")).toEqual([
      "thinking",
      "rust",
      "borrow",
      "checker",
    ]);
  });

  it("keeps technical tokens like c++, node.js and #hashtags-ish words", () => {
    const words = memoryKeywords("Compared c++ and node.js performance");
    expect(words).toContain("c++");
    expect(words).toContain("node.js");
  });
});

describe("autoTitle", () => {
  it("uses the first non-empty line, stripping markdown markers", () => {
    expect(autoTitle("\n\n## Rust borrow checker notes\nmore text")).toBe("Rust borrow checker notes");
  });

  it("trims long lines to a word boundary with an ellipsis", () => {
    const title = autoTitle("word ".repeat(40));
    expect(title.length).toBeLessThanOrEqual(81);
    expect(title.endsWith("…")).toBe(true);
  });

  it("falls back for empty content", () => {
    expect(autoTitle("   \n  ")).toBe("Untitled memory");
  });
});

describe("autoTags", () => {
  it("prefers repeated keywords and counts title words double", () => {
    const tags = autoTags(
      "The borrow checker rejects aliased mutable borrows. Borrow rules protect memory.",
      "Rust borrow checker"
    );
    expect(tags[0]).toBe("borrow");
    expect(tags).toContain("rust");
    expect(tags).toContain("checker");
  });

  it("fills from first keywords when nothing repeats, capped at 6", () => {
    const tags = autoTags("alpha bravo charlie delta echo foxtrot golf hotel");
    expect(tags).toEqual(["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"]);
  });
});

describe("summarize", () => {
  it("returns short content untouched", () => {
    expect(summarize("Just a note.")).toBe("Just a note.");
  });

  it("keeps whole leading sentences under the cap", () => {
    const content = `First sentence here. Second one follows. ${"filler ".repeat(80)}`;
    const summary = summarize(content);
    expect(summary).toBe("First sentence here. Second one follows.");
    expect(summary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
  });

  it("hard-cuts sentence-less text at a word boundary", () => {
    const summary = summarize("word ".repeat(200));
    expect(summary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
    expect(summary.endsWith("…")).toBe(true);
  });
});

describe("scoreRecall", () => {
  const memory = {
    title: "Rust borrow checker",
    summary: "Notes on aliasing rules and lifetimes.",
    tags: ["rust", "borrow"],
    content: "The compiler rejects simultaneous mutable references.",
  };

  it("weighs title and tag hits above content hits", () => {
    const titleHit = scoreRecall("borrow checker", memory);
    const contentHit = scoreRecall("compiler references", memory);
    expect(titleHit).toBeGreaterThan(contentHit);
    expect(contentHit).toBeGreaterThan(0);
  });

  it("returns 0 for unrelated or stopword-only queries", () => {
    expect(scoreRecall("gardening tips", memory)).toBe(0);
    expect(scoreRecall("what did the", memory)).toBe(0);
  });
});

describe("suggestMemoryLinks", () => {
  const memory = {
    id: "m1",
    title: "Rust borrow checker",
    summary: "Aliasing rules for mutable references.",
    tags: ["rust", "memory-safety"],
  };

  it("links on shared tags or 2+ shared keywords, best first, never itself", () => {
    const links = suggestMemoryLinks(memory, [
      { id: "m1", title: "Rust borrow checker", summary: "", tags: ["rust"] },
      { id: "m2", title: "Rust lifetimes", summary: "borrow scope rules", tags: ["rust"] },
      { id: "m3", title: "Mutable references and aliasing", summary: "", tags: [] },
      { id: "m4", title: "Sourdough starter", summary: "", tags: ["baking"] },
      { id: "m5", title: "One shared word: rust", summary: "", tags: [] },
    ]);
    expect(links[0]).toBe("m2");
    expect(links).toContain("m3");
    expect(links).not.toContain("m1");
    expect(links).not.toContain("m4");
  });

  it("caps auto links at 5", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      title: "Rust borrow notes",
      summary: "",
      tags: ["rust"],
    }));
    expect(suggestMemoryLinks(memory, candidates)).toHaveLength(5);
  });
});

describe("memoryArtifactAffinity", () => {
  const memory = {
    title: "Rust borrow checker",
    summary: "Aliasing rules for mutable references.",
    tags: ["rust", "memory-safety"],
  };

  it("scores shared tags and title-keyword overlap, 0 below thresholds", () => {
    expect(memoryArtifactAffinity(memory, { title: "Rust playground", tags: ["rust"] })).toBeGreaterThan(0);
    expect(
      memoryArtifactAffinity(memory, { title: "Borrow checker visualizer", tags: [] })
    ).toBeGreaterThan(0);
    expect(memoryArtifactAffinity(memory, { title: "Rust cheatsheet", tags: [] })).toBe(0);
    expect(memoryArtifactAffinity(memory, { title: "Sourdough timer", tags: ["baking"] })).toBe(0);
  });

  it("matches artifact-title words against memory tags too", () => {
    expect(
      memoryArtifactAffinity(memory, { title: "memory-safety rust primer", tags: [] })
    ).toBeGreaterThan(0);
  });
});

describe("suggestArtifactLinks / suggestMemoriesForArtifact", () => {
  const memory = {
    title: "Rust borrow checker",
    summary: "Aliasing rules for mutable references.",
    tags: ["rust", "memory-safety"],
  };

  it("returns best artifacts first and skips unrelated ones", () => {
    const links = suggestArtifactLinks(memory, [
      { id: "a1", title: "Sourdough timer", tags: ["baking"] },
      { id: "a2", title: "Rust borrow visualizer", tags: ["rust"] },
      { id: "a3", title: "Borrow checker demo", tags: [] },
    ]);
    expect(links[0]).toBe("a2");
    expect(links).toContain("a3");
    expect(links).not.toContain("a1");
  });

  it("caps suggestions at 5", () => {
    const artifacts = Array.from({ length: 10 }, (_, i) => ({
      id: `a${i}`,
      title: "Rust borrow demo",
      tags: ["rust"],
    }));
    expect(suggestArtifactLinks(memory, artifacts)).toHaveLength(5);
  });

  it("suggests memories for an artifact with the same affinity, roles swapped", () => {
    const memories = [
      { id: "m1", title: "Rust borrow checker", summary: "Aliasing rules.", tags: ["rust"] },
      { id: "m2", title: "Sourdough starter", summary: "", tags: ["baking"] },
    ];
    const links = suggestMemoriesForArtifact({ title: "Rust borrow visualizer", tags: ["rust"] }, memories);
    expect(links).toEqual(["m1"]);
  });
});
