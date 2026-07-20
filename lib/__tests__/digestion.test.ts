import { describe, expect, it } from "vitest";
import {
  internalLinks,
  MAX_SEGMENTS,
  segmentContent,
  type DigestSegment,
} from "../digestion";

describe("segmentContent — chat transcripts", () => {
  const chat = [
    "User: How do I set up Postgres full text search on a large table?",
    "Assistant: Use a tsvector column and a GIN index over it for fast lookups.",
    "User: And how do I rank the results by relevance to the query?",
    "Assistant: Use ts_rank against the query and order by it descending.",
  ].join("\n");

  it("splits a chat export into one segment per turn", () => {
    const plan = segmentContent(chat);
    expect(plan.strategy).toBe("chat");
    expect(plan.segments).toHaveLength(4);
    expect(plan.segments[0].content).toContain("set up Postgres");
    expect(plan.segments[0].reason).toContain("user");
    expect(plan.segments[1].reason).toContain("assistant");
  });

  it("recognizes bold and heading-style role markers", () => {
    const md = [
      "**Human:** Can you explain how the Rust borrow checker enforces lifetimes at compile time?",
      "**AI:** It tracks references so no reference outlives the value it points to, statically.",
      "**Human:** And how does that interact with mutable aliasing across function boundaries?",
      "**AI:** Only one mutable borrow may exist at a time, which rules out data races by design.",
    ].join("\n\n");
    const plan = segmentContent(md);
    expect(plan.strategy).toBe("chat");
    expect(plan.segments.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps a preamble line with the first turn instead of dropping it", () => {
    const withHeader = ["Exported from ChatGPT on 2024-01-01", "", ...chat.split("\n")].join("\n");
    const plan = segmentContent(withHeader);
    const all = plan.segments.map((s) => s.content).join("\n");
    expect(all).toContain("Exported from ChatGPT");
  });
});

describe("segmentContent — documents", () => {
  it("splits a markdown document at its top-level headings", () => {
    const doc = [
      "# Introduction",
      "This project stores AI artifacts permanently.",
      "## Not a top split, stays nested? no — depends",
      "# Setup",
      "Install the dependencies and run the dev server.",
      "# Deploying",
      "Push to Vercel and set the env vars.",
    ].join("\n");
    const plan = segmentContent(doc);
    expect(plan.strategy).toBe("headings");
    expect(plan.segments).toHaveLength(3);
    expect(plan.segments[0].reason).toContain("Introduction");
    expect(plan.segments[1].reason).toContain("Setup");
  });

  it("splits on thematic rules when there are no headings or chat turns", () => {
    const doc = [
      "First idea about caching strategies and cache eviction policies at scale.",
      "---",
      "Second idea about rate limiting requests with token buckets and exponential backoff.",
      "---",
      "Third idea about idempotency keys and how they make retried writes safe to repeat.",
    ].join("\n");
    const plan = segmentContent(doc);
    expect(plan.strategy).toBe("rules");
    expect(plan.segments).toHaveLength(3);
  });
});

describe("segmentContent — nothing to split", () => {
  it("returns strategy 'none' and a single segment for one plain thought", () => {
    const plan = segmentContent(
      "A single continuous note about how the borrow checker enforces lifetimes in Rust."
    );
    expect(plan.strategy).toBe("none");
    expect(plan.segments).toHaveLength(1);
    expect(plan.links).toHaveLength(0);
  });

  it("does not split when only a single chat marker is present", () => {
    const plan = segmentContent("User: just one line, no reply captured here at all.");
    expect(plan.strategy).toBe("none");
  });
});

describe("segmentContent — never loses content and caps segment count", () => {
  it("preserves the whole source across a split", () => {
    const doc = ["# A", "alpha body", "# B", "beta body", "# C", "gamma body"].join("\n");
    const plan = segmentContent(doc);
    const joined = plan.segments.map((s) => s.content).join("\n");
    for (const token of ["alpha body", "beta body", "gamma body"]) {
      expect(joined).toContain(token);
    }
  });

  it("merges down to at most MAX_SEGMENTS", () => {
    const turns: string[] = [];
    for (let i = 0; i < MAX_SEGMENTS + 25; i++) {
      turns.push(`User: question number ${i} about distributed systems and consensus`);
      turns.push(`Assistant: a reasonably detailed answer to question number ${i} here`);
    }
    const plan = segmentContent(turns.join("\n"));
    expect(plan.segments.length).toBeLessThanOrEqual(MAX_SEGMENTS);
    expect(plan.segments.length).toBeGreaterThan(1);
  });
});

describe("internalLinks — implicit links between pieces", () => {
  const seg = (ordinal: number, title: string, tags: string[]): DigestSegment => ({
    ordinal,
    title,
    content: "",
    summary: title,
    tags,
    reason: "",
  });

  it("chains adjacent segments as sequence links", () => {
    const segs = [seg(0, "one", []), seg(1, "two", []), seg(2, "three", [])];
    const links = internalLinks(segs);
    const sequence = links.filter((l) => l.kind === "sequence");
    expect(sequence).toEqual([
      { a: 0, b: 1, kind: "sequence" },
      { a: 1, b: 2, kind: "sequence" },
    ]);
  });

  it("adds a theme link between non-adjacent segments that share a tag", () => {
    const segs = [
      seg(0, "Postgres indexing notes", ["postgres"]),
      seg(1, "An unrelated grocery list", ["food"]),
      seg(2, "More Postgres tuning", ["postgres"]),
    ];
    const links = internalLinks(segs);
    expect(links).toContainEqual({ a: 0, b: 2, kind: "theme" });
  });

  it("does not duplicate a sequence pair as a theme link", () => {
    const segs = [seg(0, "Postgres one", ["postgres"]), seg(1, "Postgres two", ["postgres"])];
    const links = internalLinks(segs);
    expect(links).toHaveLength(1);
    expect(links[0].kind).toBe("sequence");
  });
});
