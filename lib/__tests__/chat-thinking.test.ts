import { describe, expect, it } from "vitest";
import { stripThinking } from "@/lib/chat/thinking";

describe("stripThinking", () => {
  it("returns plain replies untouched (trimmed)", () => {
    expect(stripThinking("Just an answer.")).toEqual({
      text: "Just an answer.",
      reasoning: "",
    });
    expect(stripThinking("  padded  ").text).toBe("padded");
    expect(stripThinking("")).toEqual({ text: "", reasoning: "" });
  });

  it("splits a closed think block from the visible answer", () => {
    const { text, reasoning } = stripThinking(
      "<think>Let me plan the component first.</think>Here is your timer!"
    );
    expect(text).toBe("Here is your timer!");
    expect(reasoning).toBe("Let me plan the component first.");
  });

  it("handles <thinking> spelling and mixed case", () => {
    const { text, reasoning } = stripThinking("<THINKING>scratch</THINKING>answer");
    expect(text).toBe("answer");
    expect(reasoning).toBe("scratch");
  });

  it("removes multiple interleaved blocks and keeps all visible text", () => {
    const { text, reasoning } = stripThinking(
      "<think>step one</think>Part A. <think>step two</think>Part B."
    );
    expect(text).toBe("Part A. Part B.");
    expect(reasoning).toBe("step one\n\nstep two");
  });

  it("treats an unclosed <think> as reasoning to the end (token-limit cutoff)", () => {
    const { text, reasoning } = stripThinking(
      "The answer starts here.<think>and then the model ran out of tok"
    );
    expect(text).toBe("The answer starts here.");
    expect(reasoning).toBe("and then the model ran out of tok");
  });

  it("treats everything before an orphan </think> as reasoning (opener lost upstream)", () => {
    const raw = [
      "const [stats, setStats] = useState(() => {",
      "  try {",
      "",
      "</think>",
      "",
    ].join("\n");
    const { text, reasoning } = stripThinking(raw);
    expect(text).toBe("");
    expect(reasoning).toContain("try {");
    expect(reasoning).not.toContain("</think>");
  });

  it("keeps the visible answer after an orphan </think>", () => {
    const { text, reasoning } = stripThinking("planning...\n</think>\nThe real answer.");
    expect(text).toBe("The real answer.");
    expect(reasoning).toBe("planning...");
  });
});
