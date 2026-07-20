import { describe, expect, it } from "vitest";
import { buildFeedbackContext, feedbackExcerpt } from "@/lib/chat/feedback";

describe("feedbackExcerpt", () => {
  it("collapses whitespace into one line", () => {
    expect(feedbackExcerpt("a reply\n\nwith   paragraphs\tand tabs")).toBe(
      "a reply with paragraphs and tabs"
    );
  });

  it("caps long replies with an ellipsis", () => {
    const excerpt = feedbackExcerpt("word ".repeat(200));
    expect(excerpt.length).toBeLessThanOrEqual(280);
    expect(excerpt.endsWith("…")).toBe(true);
  });
});

describe("buildFeedbackContext", () => {
  it("returns empty with no ratings", () => {
    expect(buildFeedbackContext([], [])).toBe("");
    expect(buildFeedbackContext(["   "], ["\n"])).toBe("");
  });

  it("lists liked and disliked excerpts under their headers", () => {
    const ctx = buildFeedbackContext(["short and direct"], ["a rambling wall of text"]);
    expect(ctx).toContain("Replies the user liked:");
    expect(ctx).toContain('- "short and direct"');
    expect(ctx).toContain("Replies the user disliked:");
    expect(ctx).toContain('- "a rambling wall of text"');
    expect(ctx).toContain("Never mention the ratings");
  });

  it("works one-sided and caps examples per side", () => {
    const ctx = buildFeedbackContext(
      ["one", "two", "three", "four", "five", "six"],
      []
    );
    expect(ctx).toContain("Replies the user liked:");
    expect(ctx).not.toContain("Replies the user disliked:");
    expect(ctx.match(/^- /gm)).toHaveLength(4);
  });
});
