import { describe, expect, it } from "vitest";
import { concatFloat32, downloadPercent, prepareSpeechText } from "@/lib/tts/audio";

describe("concatFloat32", () => {
  it("joins chunks in order", () => {
    const out = concatFloat32([new Float32Array([1, 2]), new Float32Array([3]), new Float32Array([4, 5])]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it("handles empty input", () => {
    expect(concatFloat32([]).length).toBe(0);
    expect(concatFloat32([new Float32Array(0)]).length).toBe(0);
  });
});

describe("downloadPercent", () => {
  const expected = { a: 100, b: 300 };

  it("counts files that haven't started yet in the denominator", () => {
    const seen = new Map([["a", { loaded: 100, total: 100 }]]);
    expect(downloadPercent(seen, expected)).toBe(25);
  });

  it("never goes backwards as sequential downloads begin", () => {
    const steps = [
      new Map([["a", { loaded: 50, total: 100 }]]),
      new Map([["a", { loaded: 100, total: 100 }]]),
      new Map([
        ["a", { loaded: 100, total: 100 }],
        ["b", { loaded: 10, total: 300 }],
      ]),
      new Map([
        ["a", { loaded: 100, total: 100 }],
        ["b", { loaded: 300, total: 300 }],
      ]),
    ];
    const percents = steps.map((s) => downloadPercent(s, expected));
    expect(percents).toEqual([12, 25, 27, 100]);
  });

  it("replaces the expected size with the real total once a file starts", () => {
    const seen = new Map([
      ["a", { loaded: 100, total: 100 }],
      ["b", { loaded: 0, total: 700 }],
    ]);
    expect(downloadPercent(seen, expected)).toBe(12);
  });

  it("only reaches 100 when every file is complete", () => {
    const seen = new Map([
      ["a", { loaded: 100, total: 100 }],
      ["b", { loaded: 299, total: 300 }],
    ]);
    expect(downloadPercent(seen, expected)).toBe(99);
  });

  it("counts files outside the expected list", () => {
    const seen = new Map([["c", { loaded: 50, total: 100 }]]);
    expect(downloadPercent(seen, { a: 100 })).toBe(25);
  });

  it("returns 0 when nothing is known", () => {
    expect(downloadPercent(new Map(), {})).toBe(0);
  });
});

describe("prepareSpeechText", () => {
  it("passes plain prose through", () => {
    expect(prepareSpeechText("Hello there. How are you?")).toBe("Hello there. How are you?");
  });

  it("replaces fenced code blocks with a spoken placeholder", () => {
    const text = "Here you go:\n```js\nconsole.log(1);\n```\nDone.";
    expect(prepareSpeechText(text)).toBe("Here you go: Code block omitted. Done.");
  });

  it("handles an unterminated code fence", () => {
    expect(prepareSpeechText("Look:\n```py\nx = 1")).toBe("Look: Code block omitted.");
  });

  it("unwraps inline code, emphasis, and links", () => {
    expect(prepareSpeechText("Use `npm i` — it's **fast** and _easy_, see [docs](https://x.dev).")).toBe(
      "Use npm i — it's fast and easy, see docs."
    );
  });

  it("drops heading and list markers", () => {
    expect(prepareSpeechText("# Title\n- first\n- second")).toBe("Title first second");
  });

  it("collapses whitespace and trims", () => {
    expect(prepareSpeechText("  a\n\n\nb\t c  ")).toBe("a b c");
  });

  it("returns empty for markup-only content", () => {
    expect(prepareSpeechText("```\ncode\n```")).toBe("Code block omitted.");
    expect(prepareSpeechText("   \n\n")).toBe("");
  });
});
