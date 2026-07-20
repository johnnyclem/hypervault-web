import { describe, expect, it } from "vitest";
import { parseExport } from "@/lib/imports";
import { parseChatGptExport } from "@/lib/imports/chatgpt";
import { parseClaudeExport } from "@/lib/imports/claude";
import { parseGrokExport } from "@/lib/imports/grok";
import { parseMarkdownTranscript } from "@/lib/imports/markdown";

const chatgptExport = [
  {
    title: "Centering divs",
    create_time: 1700000000,
    update_time: 1700000600,
    conversation_id: "cgpt-1",
    current_node: "a2",
    mapping: {
      root: { id: "root", message: null, parent: null, children: ["sys"] },
      sys: {
        id: "sys",
        parent: "root",
        children: ["u1a", "u1b"],
        message: { author: { role: "system" }, content: { content_type: "text", parts: [""] } },
      },
      u1a: {
        id: "u1a",
        parent: "sys",
        children: [],
        message: {
          author: { role: "user" },
          content: { content_type: "text", parts: ["first draft (edited away)"] },
        },
      },
      u1b: {
        id: "u1b",
        parent: "sys",
        children: ["a1"],
        message: {
          author: { role: "user" },
          create_time: 1700000100,
          content: { content_type: "text", parts: ["how do I center a div"] },
        },
      },
      a1: {
        id: "a1",
        parent: "u1b",
        children: ["u2"],
        message: {
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["Use flexbox."] },
          metadata: { model_slug: "gpt-4o" },
        },
      },
      u2: {
        id: "u2",
        parent: "a1",
        children: ["a2"],
        message: {
          author: { role: "user" },
          content: { content_type: "text", parts: ["show code"] },
        },
      },
      a2: {
        id: "a2",
        parent: "u2",
        children: [],
        message: {
          author: { role: "assistant" },
          content: { content_type: "code", language: "css", text: ".x { display: flex; }" },
        },
      },
    },
  },
];

const claudeExport = [
  {
    uuid: "claude-1",
    name: "Vault planning",
    created_at: "2026-01-02T03:04:05Z",
    chat_messages: [
      {
        sender: "human",
        text: "help me plan a vault",
        attachments: [
          { file_name: "notes.txt", file_type: "text/plain", extracted_content: "some notes" },
        ],
      },
      { sender: "assistant", content: [{ type: "text", text: "Here's a plan." }] },
    ],
  },
];

describe("ChatGPT export parser", () => {
  it("reconstructs the visible thread through current_node", () => {
    const [convo] = parseChatGptExport(chatgptExport);
    expect(convo.externalId).toBe("cgpt-1");
    expect(convo.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(convo.messages[0].content).toBe("how do I center a div");
    expect(convo.messages.some((m) => m.content.includes("edited away"))).toBe(false);
  });

  it("fences code parts and keeps model metadata", () => {
    const [convo] = parseChatGptExport(chatgptExport);
    expect(convo.messages[3].content).toContain("```css");
    expect(convo.messages[1].model).toBe("gpt-4o");
  });
});

describe("Claude export parser", () => {
  it("maps senders, content blocks, and attachments", () => {
    const [convo] = parseClaudeExport(claudeExport);
    expect(convo.title).toBe("Vault planning");
    expect(convo.messages[0].role).toBe("user");
    expect(convo.messages[0].attachments[0].extracted_text).toBe("some notes");
    expect(convo.messages[1].content).toBe("Here's a plan.");
  });
});

describe("Grok export parser", () => {
  it("parses responses with sender flags", () => {
    const [convo] = parseGrokExport([
      {
        conversation_id: "g1",
        title: "test",
        responses: [
          { sender: "human", message: "hi grok" },
          { sender: "grok", message: "hello human" },
        ],
      },
    ]);
    expect(convo.messages).toHaveLength(2);
    expect(convo.messages[1].role).toBe("assistant");
  });
});

describe("markdown transcript fallback", () => {
  it("splits on speaker labels including platform aliases", () => {
    const [convo] = parseMarkdownTranscript(
      "User: hello\nsome continuation\nChatGPT: hi there\nUser: bye"
    );
    expect(convo.messages).toHaveLength(3);
    expect(convo.messages[0].content).toBe("hello\nsome continuation");
    expect(convo.messages[1].role).toBe("assistant");
  });

  it("returns nothing for label-free text", () => {
    expect(parseMarkdownTranscript("just some prose with no speakers")).toHaveLength(0);
  });
});

describe("parseExport auto-detection", () => {
  it("detects ChatGPT exports", () => {
    const result = parseExport(JSON.stringify(chatgptExport));
    expect(result.platform).toBe("chatgpt");
    expect(result.conversations).toHaveLength(1);
  });

  it("detects Claude exports", () => {
    const result = parseExport(JSON.stringify(claudeExport));
    expect(result.platform).toBe("claude");
  });

  it("accepts already-canonical generic JSON", () => {
    const result = parseExport(
      JSON.stringify([
        { title: "custom", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }] },
      ])
    );
    expect(result.platform).toBe("other");
    expect(result.conversations[0].messages).toHaveLength(2);
  });

  it("falls back to the transcript parser for non-JSON", () => {
    const result = parseExport("Human: manual copy paste\nClaude: works fine");
    expect(result.conversations[0].messages).toHaveLength(2);
  });
});
