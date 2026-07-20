import { describe, expect, it } from "vitest";
import { escapeHtml, shareTitle, wrapTextAsHtmlPage } from "@/lib/chat/share";

describe("escapeHtml", () => {
  it("neutralizes markup and quotes", () => {
    expect(escapeHtml(`<script>alert("hi") & 'bye'</script>`)).toBe(
      "&lt;script&gt;alert(&quot;hi&quot;) &amp; &#39;bye&#39;&lt;/script&gt;"
    );
  });
});

describe("shareTitle", () => {
  it("prefers the prompt that produced the reply", () => {
    expect(shareTitle("Sure! Here's the plan…", "plan my week")).toBe("plan my week");
  });

  it("falls back to the reply's first meaningful line, sans markdown lead-in", () => {
    expect(shareTitle("## The Plan\nStep one…")).toBe("The Plan");
    expect(shareTitle("\n\n- first bullet\nmore")).toBe("first bullet");
  });

  it("caps at 80 chars and has a last-resort default", () => {
    expect(shareTitle("x".repeat(200)).length).toBe(80);
    expect(shareTitle("   \n  ")).toBe("Chat reply");
  });
});

describe("wrapTextAsHtmlPage", () => {
  it("produces a full HTML document with the reply escaped", () => {
    const page = wrapTextAsHtmlPage("Line one\n<b>not bold</b>", "My <Title>");
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page).toContain("<title>My &lt;Title&gt;</title>");
    expect(page).toContain("&lt;b&gt;not bold&lt;/b&gt;");
    expect(page).not.toContain("<b>not bold</b>");
    expect(page).toContain("Line one\n&lt;b&gt;");
  });
});
