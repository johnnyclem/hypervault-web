import { describe, expect, it } from "vitest";
import {
  buildRecallQuery,
  excerptMemory,
  queryNumberRefs,
  recallContext,
  type RecalledMemory,
} from "@/lib/recall";

function memory(overrides: Partial<RecalledMemory> = {}): RecalledMemory {
  return {
    title: "Co-parenting message log",
    summary: "Co-parenting message log · messages 1–2498 · 2025-06-17 to 2026-06-19",
    content: "",
    tags: ["notes", "nani", "jonathan"],
    excerpt: "",
    ...overrides,
  };
}

describe("excerptMemory", () => {
  it("returns short content whole", () => {
    const content = "Jonathan packs the school lunches on Mondays.";
    expect(excerptMemory(content, "school lunches", 6000)).toBe(content);
  });

  it("pulls the passages that match the query out of a long log", () => {
    const filler = Array.from({ length: 200 }, (_, i) => `[${i}] Random chatter about weekend plans and errands.`);
    filler[57] = "[57] Nani: can you pack the school lunches this week? I'm traveling.";
    filler[158] = "[158] Jonathan: school lunches are handled, I bought supplies for the whole month.";
    const content = filler.join("\n");

    const excerpt = excerptMemory(content, "what did we say about school lunches?", 2000);
    expect(excerpt.length).toBeLessThanOrEqual(2000);
    expect(excerpt).toContain("pack the school lunches this week");
    expect(excerpt).toContain("bought supplies for the whole month");
    expect(excerpt).toContain("[…]");
  });

  it("keeps selected passages in document order", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `[${i}] filler line about nothing in particular here.`);
    lines[80] = "[80] second lunches mention";
    lines[10] = "[10] first lunches mention";
    const excerpt = excerptMemory(lines.join("\n"), "lunches", 1500);
    expect(excerpt.indexOf("[10]")).toBeGreaterThanOrEqual(0);
    expect(excerpt.indexOf("[10]")).toBeLessThan(excerpt.indexOf("[80]"));
  });

  it("falls back to the head of the content when nothing matches", () => {
    const content = Array.from({ length: 100 }, (_, i) => `[${i}] filler line about nothing in particular here.`).join("\n");
    const excerpt = excerptMemory(content, "zebra xylophone", 800);
    expect(excerpt.length).toBeLessThanOrEqual(800);
    expect(excerpt).toContain("[0]");
    expect(excerpt).toContain("[…]");
  });

  it("trims the best block when even one block overflows the budget", () => {
    const oneLongLine = `lunches ${"x".repeat(5000)}`;
    const excerpt = excerptMemory(`padding\n${oneLongLine}`, "lunches", 400);
    expect(excerpt.length).toBeLessThanOrEqual(400);
    expect(excerpt).toContain("lunches");
  });

  it("pulls an explicitly requested message-number range", () => {
    const lines = Array.from(
      { length: 600 },
      (_, i) => `[${i}] Nani · 2025-08-11 15:30 CDT: chatter about weekend plans and errands.`
    );
    const excerpt = excerptMemory(lines.join("\n"), "pull messages 410-424", 4000);
    expect(excerpt).toContain("[410]");
    expect(excerpt).toContain("[415]");
    expect(excerpt).toContain("[424]");
    expect(excerpt).not.toContain("[100]");
  });

  it("pulls a single explicitly requested message number", () => {
    const lines = Array.from({ length: 600 }, (_, i) => `[${i}] filler line about nothing much.`);
    lines[427] = "[427] Nani: how much of coco's Katie time have you paid?";
    const excerpt = excerptMemory(lines.join("\n"), "show me message 427 in full", 2000);
    expect(excerpt).toContain("[427] Nani");
  });

  it("understands 'X to Y' range phrasing", () => {
    const lines = Array.from({ length: 600 }, (_, i) => `[${i}] filler line about nothing much.`);
    const excerpt = excerptMemory(lines.join("\n"), "pull messages 405 to 411 please", 3000);
    expect(excerpt).toContain("[405]");
    expect(excerpt).toContain("[411]");
  });
});

describe("queryNumberRefs", () => {
  it("expands ranges and keeps standalone numbers", () => {
    const refs = queryNumberRefs("pull messages 410-412 and also 427");
    expect(refs.has("410")).toBe(true);
    expect(refs.has("411")).toBe(true);
    expect(refs.has("412")).toBe(true);
    expect(refs.has("427")).toBe(true);
  });

  it("does not expand date fragments as ranges", () => {
    const refs = queryNumberRefs("what happened on 2025-08-11?");
    expect(refs.has("1000")).toBe(false);
    expect(refs.has("2025")).toBe(true);
    expect(refs.has("11")).toBe(true);
  });

  it("degrades huge spans to their endpoints", () => {
    const refs = queryNumberRefs("messages 1-2498");
    expect(refs.has("1")).toBe(true);
    expect(refs.has("2498")).toBe(true);
    expect(refs.has("1200")).toBe(false);
  });
});

describe("buildRecallQuery", () => {
  const history = [
    { role: "user", content: "tell me where you can find the log about school lunches" },
    { role: "assistant", content: "The school lunch discussion is in log 5, messages 427-431." },
  ];

  it("returns a keyword-rich message unchanged", () => {
    const q = "tell me where you can find the log about school lunches";
    expect(buildRecallQuery(q, history)).toBe(q);
  });

  it("borrows recent turns for a thin follow-up", () => {
    const q = buildRecallQuery("yes pull the full text", history);
    expect(q).toContain("yes pull the full text");
    expect(q).toContain("school lunch");
    expect(q).toContain("427-431");
  });

  it("keeps a thin message intact with no history to borrow", () => {
    expect(buildRecallQuery("check it again", [])).toBe("check it again");
  });
});

describe("recallContext", () => {
  it("quotes the memory excerpt, not just the summary", () => {
    const m = memory({
      content: "full content lives here",
      excerpt: "[57] Nani: can you pack the school lunches this week?",
    });
    const ctx = recallContext([], [m]);
    expect(ctx).toContain("pack the school lunches this week");
    expect(ctx).toContain('Memory: "Co-parenting message log"');
    expect(ctx).toContain("quoted directly from the vault");
    expect(ctx).toContain("no separate search or fetch tool");
    expect(ctx).toContain("recall runs fresh on EVERY message");
  });

  it("falls back to a content snippet when a memory has no excerpt", () => {
    const m = memory({ content: "the actual body of the memory", excerpt: "" });
    const ctx = recallContext([], [m]);
    expect(ctx).toContain("the actual body of the memory");
  });

  it("returns empty for no recall results", () => {
    expect(recallContext([], [])).toBe("");
  });
});
