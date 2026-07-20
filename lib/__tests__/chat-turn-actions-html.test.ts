import { describe, expect, it } from "vitest";
import {
  hasTurnActionsBar,
  injectTurnActionsBar,
  isChatArtifact,
  isChatTranscriptHtml,
  shouldShowTurnActionsBar,
  turnActionsBarHtml,
} from "@/lib/chat/turn-actions-html";
import { wrapJsxAsHtml } from "@/lib/jsx";
import { wrapTextAsHtmlPage } from "@/lib/chat/share";

const META = { slug: "my-reply-abc123", title: "My reply" };

describe("isChatArtifact", () => {
  it("matches the tags the chat surfaces record", () => {
    expect(isChatArtifact(["chat"])).toBe(true);
    expect(isChatArtifact(["memories"])).toBe(true);
    expect(isChatArtifact(["chat", "games"])).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isChatArtifact(["games", "demo"])).toBe(false);
    expect(isChatArtifact([])).toBe(false);
    expect(isChatArtifact(null)).toBe(false);
    expect(isChatArtifact(undefined)).toBe(false);
    expect(isChatArtifact("chat")).toBe(false);
    expect(isChatArtifact([42])).toBe(false);
  });
});

describe("isChatTranscriptHtml", () => {
  it("recognizes a freshly wrapped prose reply via its marker", () => {
    const page = wrapTextAsHtmlPage("Here is the answer.", "Question?");
    expect(page).toContain('name="hypervault-chat-transcript"');
    expect(isChatTranscriptHtml(page)).toBe(true);
  });

  it("recognizes a legacy transcript by its wrapper signature (no marker)", () => {
    const legacy = `<!doctype html><html><head><style>article { white-space: pre-wrap; }</style></head><body><article>hi</article></body></html>`;
    expect(legacy).not.toContain("hypervault-chat-transcript");
    expect(isChatTranscriptHtml(legacy)).toBe(true);
  });

  it("rejects a rendered HTML/JSX app", () => {
    expect(isChatTranscriptHtml(wrapJsxAsHtml("function App(){return <p>hi</p>;}", "App"))).toBe(false);
    expect(isChatTranscriptHtml("<!doctype html><html><body><div id=root></div><script>run()</script></body></html>")).toBe(
      false
    );
  });
});

describe("shouldShowTurnActionsBar", () => {
  const transcript = wrapTextAsHtmlPage("A prose reply.", "Prompt");

  it("shows the bar on a chat transcript artifact", () => {
    expect(shouldShowTurnActionsBar({ tags: ["chat"], is_jsx: false, content: transcript })).toBe(true);
    expect(shouldShowTurnActionsBar({ tags: ["memories"], is_jsx: false, content: transcript })).toBe(true);
  });

  it("never shows the bar on a JSX/canvas artifact, even one tagged from chat", () => {
    const app = wrapJsxAsHtml("function App(){return <p>hi</p>;}", "App");
    expect(shouldShowTurnActionsBar({ tags: ["chat"], is_jsx: true, content: app })).toBe(false);
  });

  it("never shows the bar on a rendered HTML app tagged from chat", () => {
    const html = "<!doctype html><html><body><canvas></canvas><script>go()</script></body></html>";
    expect(shouldShowTurnActionsBar({ tags: ["chat"], is_jsx: false, content: html })).toBe(false);
  });

  it("ignores non-chat artifacts entirely", () => {
    expect(shouldShowTurnActionsBar({ tags: ["games"], is_jsx: false, content: transcript })).toBe(false);
  });
});

describe("turnActionsBarHtml", () => {
  it("renders all four action groups", () => {
    const bar = turnActionsBarHtml(META);
    for (const label of ["Copy reply", "Share reply", "Good reply", "Bad reply", "Read aloud"]) {
      expect(bar).toContain(`aria-label="${label}"`);
    }
  });

  it("targets the feedback API for the artifact's slug", () => {
    expect(turnActionsBarHtml(META)).toContain('"my-reply-abc123"');
    expect(turnActionsBarHtml(META)).toContain("/api/artifacts/");
  });

  it("cannot break out of the inline script via the title or slug", () => {
    const bar = turnActionsBarHtml({ slug: "x", title: '</script><img src=x onerror=alert(1)>' });
    expect(bar).not.toContain("</script><img");
    expect(bar).toContain("\\u003c/script>");
  });
});

describe("injectTurnActionsBar", () => {
  it("inserts the bar before </body> on a wrapped chat page", () => {
    const page = wrapTextAsHtmlPage("Here is the answer.", "What was the question?");
    const injected = injectTurnActionsBar(page, META);
    expect(hasTurnActionsBar(injected)).toBe(true);
    const barAt = injected.indexOf('id="hv-turn-actions"');
    expect(barAt).toBeGreaterThan(injected.indexOf("<article>"));
    expect(barAt).toBeLessThan(injected.lastIndexOf("</body>"));
  });

  it("appends when the page has no closing body tag", () => {
    const injected = injectTurnActionsBar("<h1>Bare fragment</h1>", META);
    expect(hasTurnActionsBar(injected)).toBe(true);
    expect(injected.startsWith("<h1>Bare fragment</h1>")).toBe(true);
  });

  it("is idempotent", () => {
    const once = injectTurnActionsBar(wrapTextAsHtmlPage("hi", "hi"), META);
    expect(injectTurnActionsBar(once, META)).toBe(once);
  });

  it("leaves the rest of the page byte-identical", () => {
    const page = wrapTextAsHtmlPage("Line one\nLine two", "Title");
    const injected = injectTurnActionsBar(page, META);
    expect(injected.replace(turnActionsBarHtml(META), "")).toBe(page);
  });
});
