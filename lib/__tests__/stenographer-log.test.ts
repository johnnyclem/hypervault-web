import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appendFileMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("node:fs/promises", () => ({ appendFile: appendFileMock }));

import { appendTranscript, toJsonlTurns, type TranscriptTurn } from "@/lib/stenographer/log";

const TURNS: TranscriptTurn[] = [
  { role: "user", content: "What's our launch phrase?" },
  { role: "assistant", content: "aardvark-7, per the earlier decision." },
];

beforeEach(() => {
  appendFileMock.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("toJsonlTurns", () => {
  it("emits one stenographer-shaped JSON line per turn, newline terminated", () => {
    const out = toJsonlTurns("convo-1", TURNS, new Date("2026-07-14T12:00:00Z"));
    expect(out.endsWith("\n")).toBe(true);
    const lines = out.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      role: "user",
      content: "What's our launch phrase?",
      sessionId: "convo-1",
    });
    expect(lines[0].id).toMatch(/^msg_[0-9a-f]{16}$/);
    expect(new Date(lines[0].timestamp).toISOString()).toBe(lines[0].timestamp);
    expect(new Date(lines[1].timestamp).getTime()).toBeGreaterThan(
      new Date(lines[0].timestamp).getTime()
    );
  });

  it("derives stable ids from content, so re-appends are deduplicable", () => {
    const a = toJsonlTurns("convo-1", TURNS, new Date(1000));
    const b = toJsonlTurns("convo-1", TURNS, new Date(2000));
    expect(JSON.parse(a.split("\n")[0]).id).toBe(JSON.parse(b.split("\n")[0]).id);
  });
});

describe("appendTranscript", () => {
  it("no-ops when STENOGRAPHER_LOG_PATH is unset", async () => {
    vi.stubEnv("STENOGRAPHER_LOG_PATH", "");
    await appendTranscript("convo-1", TURNS);
    expect(appendFileMock).not.toHaveBeenCalled();
  });

  it("appends the JSONL turns when a log path is configured", async () => {
    vi.stubEnv("STENOGRAPHER_LOG_PATH", "/var/lib/stenographer/chat.jsonl");
    await appendTranscript("convo-1", TURNS);
    expect(appendFileMock).toHaveBeenCalledOnce();
    const [path, data] = appendFileMock.mock.calls[0] as unknown as [string, string];
    expect(path).toBe("/var/lib/stenographer/chat.jsonl");
    expect(data.trim().split("\n")).toHaveLength(2);
  });

  it("swallows filesystem failures — the chat turn must not care", async () => {
    vi.stubEnv("STENOGRAPHER_LOG_PATH", "/readonly/chat.jsonl");
    appendFileMock.mockRejectedValueOnce(new Error("EROFS"));
    await expect(appendTranscript("convo-1", TURNS)).resolves.toBeUndefined();
  });
});
