import { describe, expect, it } from "vitest";
import { extractChatArtifact, guessArtifactTitle } from "@/lib/chat/artifact";

const HTML_PAGE = `<!DOCTYPE html>
<html>
<head><title>Orbit Tracker</title></head>
<body><h1>Satellites overhead</h1><p>Live positions.</p></body>
</html>`;

const JSX_COMPONENT = `import { useState } from "react";

export default function PomodoroTimer() {
  const [seconds, setSeconds] = useState(1500);
  return <div className="timer">{seconds}</div>;
}`;

describe("extractChatArtifact", () => {
  it("finds a fenced HTML page and titles it from <title>", () => {
    const message = `Here's your page!\n\n\`\`\`html\n${HTML_PAGE}\n\`\`\`\n\nWant any tweaks?`;
    const artifact = extractChatArtifact(message);
    expect(artifact?.kind).toBe("html");
    expect(artifact?.content).toBe(HTML_PAGE);
    expect(artifact?.title).toBe("Orbit Tracker");
  });

  it("finds a fenced JSX component and titles it from the component name", () => {
    const message = `Sure — here you go:\n\n\`\`\`jsx\n${JSX_COMPONENT}\n\`\`\``;
    const artifact = extractChatArtifact(message);
    expect(artifact?.kind).toBe("jsx");
    expect(artifact?.content).toBe(JSX_COMPONENT);
    expect(artifact?.title).toBe("Pomodoro Timer");
  });

  it("classifies unlabeled and js-labeled fences via JSX heuristics", () => {
    const unlabeled = extractChatArtifact(`\`\`\`\n${JSX_COMPONENT}\n\`\`\``);
    expect(unlabeled?.kind).toBe("jsx");
    const jsLabeled = extractChatArtifact(`\`\`\`js\n${JSX_COMPONENT}\n\`\`\``);
    expect(jsLabeled?.kind).toBe("jsx");
  });

  it("treats an unlabeled fenced HTML fragment as html", () => {
    const fragment = `<div class="card">\n  <h1>Hello</h1>\n  <p>A fragment big enough to matter.</p>\n</div>`;
    const artifact = extractChatArtifact(`\`\`\`\n${fragment}\n\`\`\``);
    expect(artifact?.kind).toBe("html");
  });

  it("picks the longest qualifying block when a reply has several fences", () => {
    const small = `<div><p>tiny page fragment for the demo, kept simple</p><span>ok</span></div>`;
    const message = `\`\`\`html\n${small}\n\`\`\`\n\nAnd the full page:\n\n\`\`\`html\n${HTML_PAGE}\n\`\`\``;
    expect(extractChatArtifact(message)?.content).toBe(HTML_PAGE);
  });

  it("skips fenced blocks in non-artifact languages", () => {
    const message = `\`\`\`python\nprint("hello from a script that is definitely long enough")\n\`\`\``;
    expect(extractChatArtifact(message)).toBeNull();
  });

  it("accepts a bare full HTML document with no fences", () => {
    const artifact = extractChatArtifact(HTML_PAGE);
    expect(artifact?.kind).toBe("html");
    expect(artifact?.content).toBe(HTML_PAGE.trim());
  });

  it("accepts bare JSX when the reply opens like code", () => {
    const artifact = extractChatArtifact(JSX_COMPONENT);
    expect(artifact?.kind).toBe("jsx");
  });

  it("ignores prose that merely talks about code", () => {
    const message =
      "You could use useState for that, and className works like class in HTML. " +
      "Try wrapping your markup in a component and returning it from a function.";
    expect(extractChatArtifact(message)).toBeNull();
  });

  it("ignores replies and blocks below the minimum size", () => {
    expect(extractChatArtifact("<html><body>hi</body></html>")).toBeNull();
    expect(extractChatArtifact("```html\n<div>hi</div>\n```")).toBeNull();
  });
});

describe("extractChatArtifact and reasoning traces", () => {
  it("never saves the code sketch from a reasoning trace", () => {
    const sketch = `\`\`\`jsx
function PomodoroSketch() {
  const [seconds, setSeconds] = useState(1500);
  const progress = useMemo(() => 1 - seconds / 1500, [seconds]);
  // ... etc
}
\`\`\``;
    const message = `<think>Let me draft this:\n\n${sketch}\n\nOk, now write it fully.</think>Here you go:\n\n\`\`\`jsx\n${JSX_COMPONENT}\n\`\`\``;
    const artifact = extractChatArtifact(message);
    expect(artifact?.kind).toBe("jsx");
    expect(artifact?.content).toBe(JSX_COMPONENT);
    expect(artifact?.content).not.toContain("// ... etc");
  });

  it("offers nothing when the reply is only a truncated reasoning trace", () => {
    const message = `const [stats, setStats] = useState(() => {
    try {
      const stored = localStorage.getItem(STATS_KEY);
      return stored ? JSON.parse(stored) : { totalPomodoros: 0 };
    } catch { return { totalPomodoros: 0 }; }
  });
  const [todayCount, setTodayCount] = useState(() => {
    try {

</think>`;
    expect(extractChatArtifact(message)).toBeNull();
  });

  it("detects the artifact in a fence left unclosed by a token-limit cutoff", () => {
    const truncated = `Here's your component:\n\n\`\`\`jsx\n${JSX_COMPONENT}\n  // the closing fence never arrived`;
    const artifact = extractChatArtifact(truncated);
    expect(artifact?.kind).toBe("jsx");
    expect(artifact?.content).toContain("export default function PomodoroTimer");
    expect(artifact?.title).toBe("Pomodoro Timer");
  });

  it("still prefers a complete fence over a shorter trailing open one", () => {
    const message = `\`\`\`jsx\n${JSX_COMPONENT}\n\`\`\`\n\nAnd a fragment:\n\`\`\`js\nconst tail = useState(0); const x = <div className="cut" />;`;
    expect(extractChatArtifact(message)?.content).toBe(JSX_COMPONENT);
  });

  it("ignores fences that exist only inside the reasoning trace", () => {
    const message = `<think>maybe:\n\`\`\`jsx\n${JSX_COMPONENT}\n\`\`\`\n</think>Actually, you don't need code for this — just use the built-in timer app.`;
    expect(extractChatArtifact(message)).toBeNull();
  });
});

describe("guessArtifactTitle", () => {
  it("falls back to the first <h1> when there is no <title>", () => {
    const title = guessArtifactTitle({
      kind: "html",
      content: `<div><h1>Launch <em>Checklist</em></h1><p>ok</p></div>`,
    });
    expect(title).toBe("Launch Checklist");
  });

  it("returns null when nothing nameable exists", () => {
    expect(guessArtifactTitle({ kind: "html", content: "<div><p>anon</p></div>" })).toBeNull();
    expect(guessArtifactTitle({ kind: "jsx", content: "export default () => <div />;" })).toBeNull();
  });
});
