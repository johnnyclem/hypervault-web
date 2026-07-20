import { describe, expect, it } from "vitest";
import {
  formatToolResultBlock,
  parseIntentCall,
  parseToolResultBlock,
  toolSystemPrompt,
} from "@/lib/smallchat/intent";
import type { ToolResult } from "@/lib/vendor/smallchat/core/types";

describe("parseIntentCall", () => {
  it("parses a trailing tool block and preserves the visible text", () => {
    const text = 'Let me save that.\n\n```tool\n{"intent": "save html to the vault", "args": {"title": "Demo"}}\n```';
    const parsed = parseIntentCall(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.call.intent).toBe("save html to the vault");
    expect(parsed!.call.args).toEqual({ title: "Demo" });
    expect(parsed!.visibleText).toBe("Let me save that.");
  });

  it("defaults args to an empty object", () => {
    const parsed = parseIntentCall('```tool\n{"intent": "list my vault items"}\n```');
    expect(parsed!.call.args).toEqual({});
  });

  it("returns null for malformed JSON (plain-text passthrough, no retry)", () => {
    expect(parseIntentCall("```tool\nnot json\n```")).toBeNull();
  });

  it("returns null when intent is missing, empty, or oversized", () => {
    expect(parseIntentCall('```tool\n{"args": {}}\n```')).toBeNull();
    expect(parseIntentCall('```tool\n{"intent": "   "}\n```')).toBeNull();
    expect(parseIntentCall(`\`\`\`tool\n{"intent": "${"x".repeat(600)}"}\n\`\`\``)).toBeNull();
  });

  it("returns null when args is an array", () => {
    expect(parseIntentCall('```tool\n{"intent": "do it", "args": [1]}\n```')).toBeNull();
  });

  it("only honors the first block", () => {
    const text = '```tool\n{"intent": "first"}\n```\nmiddle\n```tool\n{"intent": "second"}\n```';
    expect(parseIntentCall(text)!.call.intent).toBe("first");
  });

  it("ignores replies without a tool block", () => {
    expect(parseIntentCall("Just a normal reply with ```js\ncode\n``` inside.")).toBeNull();
  });

  it("parses args whose JSON string values contain embedded code fences", () => {
    const markdown =
      "# SmallChat\n\nA widget.\n\n## Integration\n```html\n<script src=\"x\"></script>\n```\n\nReact:\n```jsx\nimport { SmallChat } from \"smallchat\";\n```\n";
    const payload = {
      intent: "create a new page about SmallChat",
      args: { title: "SmallChat", markdown },
    };
    const text = "I'll create that page.\n\n```tool\n" + JSON.stringify(payload) + "\n```";
    const parsed = parseIntentCall(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.call.intent).toBe("create a new page about SmallChat");
    expect(parsed!.call.args.markdown).toBe(markdown);
    expect(parsed!.visibleText).toBe("I'll create that page.");
  });

  it("returns null when the tool block's JSON object is never closed", () => {
    expect(parseIntentCall('```tool\n{"intent": "do it", "args": {"a": 1}')).toBeNull();
  });
});

describe("formatToolResultBlock", () => {
  const call = { intent: "save html", args: {} };

  it("round-trips through parseToolResultBlock", () => {
    const result: ToolResult = {
      content: [{ type: "text", text: "saved" }],
      metadata: { confidence: 0.93, tier: "exact", proof: { resolvedTool: "save_to_hypervault" } },
    };
    const block = formatToolResultBlock(call, result);
    expect(block.startsWith("```tool-result\n")).toBe(true);
    const parsed = parseToolResultBlock(block);
    expect(parsed).toMatchObject({
      intent: "save html",
      tool: "save_to_hypervault",
      ok: true,
      confidence: 0.93,
      tier: "exact",
    });
  });

  it("truncates oversized content", () => {
    const result: ToolResult = { content: "y".repeat(10_000) };
    const parsed = parseToolResultBlock(formatToolResultBlock(call, result));
    expect((parsed!.content as string).length).toBeLessThan(9_000);
    expect(parsed!.content as string).toContain("[truncated");
  });

  it("carries errors as ok:false", () => {
    const result: ToolResult = { content: "boom", isError: true };
    const parsed = parseToolResultBlock(formatToolResultBlock(call, result));
    expect(parsed!.ok).toBe(false);
    expect(parsed!.error).toBe("boom");
    expect(parsed!.content).toBeUndefined();
  });

  it("round-trips tool-result content that contains code fences", () => {
    const result: ToolResult = {
      content: "Fetched:\n```html\n<h1>hi</h1>\n```\ndone",
    };
    const parsed = parseToolResultBlock(formatToolResultBlock(call, result));
    expect(parsed).not.toBeNull();
    expect(parsed!.content).toBe("Fetched:\n```html\n<h1>hi</h1>\n```\ndone");
  });

  it("surfaces refinement questions and options", () => {
    const result: ToolResult = {
      content: null,
      refinement: {
        type: "tool_refinement_needed",
        originalIntent: "save html",
        question: "Which kind of save?",
        options: [
          { label: "Save an artifact", intent: "save artifact html", confidence: 0.5 },
          { label: "Save a memory", intent: "save memory", confidence: 0.4 },
        ],
        narrowedIntents: [],
      },
    };
    const parsed = parseToolResultBlock(formatToolResultBlock(call, result));
    expect(parsed!.ok).toBe(false);
    expect(parsed!.refinement!.question).toBe("Which kind of save?");
    expect(parsed!.refinement!.options).toHaveLength(2);
  });
});

describe("toolSystemPrompt", () => {
  it("embeds the capability header", () => {
    const prompt = toolSystemPrompt("### MyServer\n- do the thing");
    expect(prompt).toContain("<capabilities>");
    expect(prompt).toContain("### MyServer");
    expect(prompt).toContain("```tool");
  });
});
