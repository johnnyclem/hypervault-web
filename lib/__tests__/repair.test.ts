import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildRepairMessages,
  extractRepairedCode,
  isUnchanged,
  repairArtifactSource,
} from "@/lib/repair";

vi.mock("@/lib/backends/chat", () => ({
  sendChat: vi.fn(),
}));
import { sendChat } from "@/lib/backends/chat";
const sendChatMock = vi.mocked(sendChat);

afterEach(() => {
  sendChatMock.mockReset();
});

describe("buildRepairMessages", () => {
  it("puts the broken source in the user turn and a strict system prompt", () => {
    const { system, messages } = buildRepairMessages("<div>", "html", "My Page");
    expect(system).toMatch(/only what prevents/i);
    expect(system).toMatch(/standalone HTML page/i);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain("<div>");
    expect(messages[0].content).toContain("My Page");
  });

  it("tailors the hint for JSX and tells the model hooks are in scope", () => {
    const { system } = buildRepairMessages("function App(){}", "jsx", "Widget");
    expect(system).toMatch(/React\/JSX/i);
    expect(system).toMatch(/already in scope/i);
  });

  it("includes the browser render error when provided", () => {
    const { messages } = buildRepairMessages("code", "jsx", "T", "Unexpected token (5:2)");
    expect(messages[0].content).toContain("Unexpected token (5:2)");
  });
});

describe("extractRepairedCode", () => {
  it("returns trimmed code when the model obeys and skips fences", () => {
    expect(extractRepairedCode("  <html></html>  ")).toBe("<html></html>");
  });

  it("pulls code out of a markdown fence when the model adds one anyway", () => {
    const reply = "Sure, here's the fix:\n```jsx\nfunction App(){ return <p/>; }\n```";
    expect(extractRepairedCode(reply)).toBe("function App(){ return <p/>; }");
  });

  it("prefers the longest fenced block", () => {
    const reply = "```\nshort\n```\nand\n```\nmuch much longer block of code\n```";
    expect(extractRepairedCode(reply)).toBe("much much longer block of code");
  });

  it("strips a dangling unbalanced opening fence", () => {
    expect(extractRepairedCode("```html\n<div>hi</div>")).toBe("<div>hi</div>");
  });

  it("returns null for an empty reply", () => {
    expect(extractRepairedCode("")).toBeNull();
    expect(extractRepairedCode("   \n  ")).toBeNull();
  });
});

describe("isUnchanged", () => {
  it("ignores surrounding whitespace and line-ending differences", () => {
    expect(isUnchanged("<a>\n", "<a>")).toBe(true);
    expect(isUnchanged("a\r\nb", "a\nb")).toBe(true);
    expect(isUnchanged("<a>", "<b>")).toBe(false);
  });
});

const backend = { provider: "openai", baseUrl: null, model: "gpt-4o", apiKey: "k" };

describe("repairArtifactSource", () => {
  it("returns the cleaned code and flags a real change", async () => {
    sendChatMock.mockResolvedValue({
      text: "```html\n<html><body>fixed</body></html>\n```",
      model: "gpt-4o",
      truncated: false,
    });
    const res = await repairArtifactSource(backend, "<html><body>broke", "html", "Page");
    expect(res).toEqual({
      ok: true,
      code: "<html><body>fixed</body></html>",
      model: "gpt-4o",
      changed: true,
    });
  });

  it("flags an unchanged result when the model returns the same source", async () => {
    sendChatMock.mockResolvedValue({ text: "<p>same</p>", model: "m", truncated: false });
    const res = await repairArtifactSource(backend, "<p>same</p>\n", "html", "Page");
    expect(res).toMatchObject({ ok: true, changed: false });
  });

  it("refuses a truncated fix rather than persisting half a file", async () => {
    sendChatMock.mockResolvedValue({ text: "<html>partial", model: "m", truncated: true });
    const res = await repairArtifactSource(backend, "<html>broke", "html", "Page");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/cut off/i);
  });

  it("errors cleanly when the model returns no code", async () => {
    sendChatMock.mockResolvedValue({ text: "   ", model: "m", truncated: false });
    const res = await repairArtifactSource(backend, "<html>broke", "html", "Page");
    expect(res.ok).toBe(false);
  });

  it("surfaces a backend failure as an error result", async () => {
    sendChatMock.mockRejectedValue(new Error("Backend returned 401: bad key"));
    const res = await repairArtifactSource(backend, "<html>broke", "html", "Page");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/401/);
  });

  it("rejects an empty source without calling the backend", async () => {
    const res = await repairArtifactSource(backend, "   ", "html", "Page");
    expect(res.ok).toBe(false);
    expect(sendChatMock).not.toHaveBeenCalled();
  });

  it("asks for generous continuations so big files come back whole", async () => {
    sendChatMock.mockResolvedValue({ text: "<html>fixed</html>", model: "m", truncated: false });
    await repairArtifactSource(backend, "<html>broke", "html", "Page");
    const opts = sendChatMock.mock.calls[0][3];
    expect(opts?.maxContinuations).toBeGreaterThanOrEqual(3);
  });
});
