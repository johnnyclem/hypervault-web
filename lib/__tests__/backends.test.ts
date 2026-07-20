import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isLocalUrl,
  normalizeBaseUrl,
  resolveBackend,
  sendChat,
  toWireMessages,
} from "@/lib/backends/chat";
import { decryptSecret, encryptSecret } from "@/lib/backends/crypto";
import { anthropicBaseUrlCandidates, baseUrlCandidates, testBackend } from "@/lib/backends/probe";
import { isCustomProvider, PROVIDERS } from "@/lib/backends/providers";

describe("provider registry", () => {
  it("routes every provider to a known wire protocol", () => {
    for (const spec of Object.values(PROVIDERS)) {
      expect(["openai", "anthropic", "gemini"]).toContain(spec.protocol);
    }
  });

  it("resolves defaults and honors overrides", () => {
    expect(resolveBackend({ provider: "anthropic" })).toEqual({
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "claude-opus-4-8",
    });
    expect(resolveBackend({ provider: "xai", model: "grok-3" })?.model).toBe("grok-3");
    expect(resolveBackend({ provider: "custom" })).toBeNull();
    expect(resolveBackend({ provider: "custom-anthropic" })).toBeNull();
    expect(resolveBackend({ provider: "nope" })).toBeNull();
  });

  it("offers both API styles for custom endpoints", () => {
    expect(PROVIDERS["custom"].protocol).toBe("openai");
    expect(PROVIDERS["custom-anthropic"].protocol).toBe("anthropic");
    expect(isCustomProvider("custom")).toBe(true);
    expect(isCustomProvider("custom-anthropic")).toBe(true);
    expect(isCustomProvider("anthropic")).toBe(false);
    expect(
      resolveBackend({
        provider: "custom-anthropic",
        baseUrl: "https://gateway.example.com",
        model: "claude-opus-4-8",
      })
    ).toEqual({
      protocol: "anthropic",
      baseUrl: "https://gateway.example.com",
      model: "claude-opus-4-8",
    });
  });
});

describe("toWireMessages", () => {
  it("merges consecutive same-role turns and inlines extracted attachments", () => {
    const wire = toWireMessages([
      { role: "user", content: "part one", attachments: [] },
      {
        role: "user",
        content: "part two",
        attachments: [{ name: "notes.txt", extracted_text: "the notes" }],
      },
      { role: "assistant", content: "reply", attachments: [] },
    ]);
    expect(wire).toHaveLength(2);
    expect(wire[0].content).toContain("part one");
    expect(wire[0].content).toContain("the notes");
  });

  it("prepends a user turn when an imported thread starts with the assistant", () => {
    const wire = toWireMessages([{ role: "assistant", content: "hello!", attachments: [] }]);
    expect(wire[0].role).toBe("user");
    expect(wire[1].role).toBe("assistant");
  });
});

describe("key encryption", () => {
  it("round-trips and rejects tampered payloads", () => {
    vi.stubEnv("HYPERVAULT_KEY_SECRET", "test-secret");
    const cipher = encryptSecret("sk-super-secret")!;
    expect(cipher).not.toContain("sk-super-secret");
    expect(decryptSecret(cipher)).toBe("sk-super-secret");
    const [iv, ct, tag] = cipher.split(".");
    expect(decryptSecret([iv, ct.slice(0, -2) + "AA", tag].join("."))).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("sendChat protocol adapters", () => {
  afterEach(() => vi.restoreAllMocks());

  function mockFetch(payload: unknown) {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }) as never
    );
    return spy;
  }

  it("speaks the Anthropic messages protocol", async () => {
    const spy = mockFetch({
      model: "claude-opus-4-8",
      content: [{ type: "text", text: "hi from claude" }],
    });
    const reply = await sendChat(
      { provider: "anthropic", apiKey: "sk-ant-test" },
      [{ role: "user", content: "hello", attachments: [] }],
      "recall context"
    );
    expect(reply.text).toBe("hi from claude");

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.system).toBe("recall context");
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("speaks the OpenAI-compatible protocol (xAI)", async () => {
    const spy = mockFetch({ model: "grok-4", choices: [{ message: { content: "hi from grok" } }] });
    const reply = await sendChat(
      { provider: "xai", apiKey: "xai-test" },
      [{ role: "user", content: "hello", attachments: [] }],
      "recall context"
    );
    expect(reply.text).toBe("hi from grok");

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.messages[0]).toEqual({ role: "system", content: "recall context" });
  });

  it("speaks the Gemini generateContent protocol", async () => {
    const spy = mockFetch({
      candidates: [{ content: { parts: [{ text: "hi from gemini" }] } }],
    });
    const reply = await sendChat(
      { provider: "gemini", apiKey: "g-test" },
      [
        { role: "user", content: "hello", attachments: [] },
        { role: "assistant", content: "earlier reply", attachments: [] },
        { role: "user", content: "follow up", attachments: [] },
      ]
    );
    expect(reply.text).toBe("hi from gemini");

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain(":generateContent");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
  });

  it("speaks the Anthropic messages protocol for Anthropic-style custom endpoints", async () => {
    const spy = mockFetch({
      model: "claude-opus-4-8",
      content: [{ type: "text", text: "hi from the gateway" }],
    });
    const reply = await sendChat(
      {
        provider: "custom-anthropic",
        baseUrl: "https://gateway.example.com",
        model: "claude-opus-4-8",
        apiKey: "gw-test",
      },
      [{ role: "user", content: "hello", attachments: [] }]
    );
    expect(reply.text).toBe("hi from the gateway");

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://gateway.example.com/v1/messages");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("gw-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("sends the key as a bearer token for custom endpoints, and omits it when absent", async () => {
    const payload = { choices: [{ message: { content: "hi" } }] };
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify(payload), { status: 200 }));
    const config = { provider: "custom", baseUrl: "https://llm.example.com/v1", model: "my-model" };
    await sendChat({ ...config, apiKey: "ck-test" }, [
      { role: "user", content: "hello", attachments: [] },
    ]);
    let headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer ck-test");

    await sendChat(config, [{ role: "user", content: "hello", attachments: [] }]);
    headers = (spy.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("explains what a misconfigured custom backend is missing", async () => {
    await expect(
      sendChat({ provider: "custom", baseUrl: "https://llm.example.com/v1" }, [
        { role: "user", content: "hi", attachments: [] },
      ])
    ).rejects.toThrow(/needs a model configured/);
    await expect(
      sendChat({ provider: "custom" }, [{ role: "user", content: "hi", attachments: [] }])
    ).rejects.toThrow(/needs a base URL and a model configured/);
  });

  it("surfaces backend errors with status and detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 }) as never
    );
    await expect(
      sendChat({ provider: "openai", apiKey: "bad" }, [
        { role: "user", content: "hi", attachments: [] },
      ])
    ).rejects.toThrow(/401.*invalid api key/);
  });

  it("hints that a 404 on an OpenAI-compatible endpoint is a Base URL problem", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: 'path "/api/v1/chat/completions" not found' }), {
        status: 404,
      }) as never
    );
    await expect(
      sendChat({ provider: "custom", baseUrl: "https://ollama.com/api/v1", model: "m" }, [
        { role: "user", content: "hi", attachments: [] },
      ])
    ).rejects.toThrow(/Base URL/);
  });

  it("explains that localhost points at the server when a local backend is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      sendChat({ provider: "ollama" }, [{ role: "user", content: "hi", attachments: [] }])
    ).rejects.toThrow(/tunnel/i);
  });
});

describe("sendChat truncation handling", () => {
  afterEach(() => vi.restoreAllMocks());

  function mockFetchQueue(payloads: Array<{ status?: number; body: unknown }>) {
    let call = 0;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const next = payloads[call++];
      if (!next) throw new Error(`unexpected fetch call #${call}`);
      return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
    });
    return spy;
  }

  function requestBody(spy: ReturnType<typeof mockFetchQueue>, call: number) {
    return JSON.parse((spy.mock.calls[call][1] as RequestInit).body as string);
  }

  it("continues an OpenAI-compatible reply cut off at the token limit and stitches the rounds", async () => {
    const spy = mockFetchQueue([
      {
        body: {
          model: "minimax-m3",
          choices: [{ message: { content: "const a = 1;\nconst b" }, finish_reason: "length" }],
        },
      },
      {
        body: {
          model: "minimax-m3",
          choices: [{ message: { content: " = 2;\nexport default App;" }, finish_reason: "stop" }],
        },
      },
    ]);
    const reply = await sendChat(
      { provider: "custom", baseUrl: "https://llm.example.com/v1", model: "minimax-m3" },
      [{ role: "user", content: "write it", attachments: [] }]
    );
    expect(reply.text).toBe("const a = 1;\nconst b = 2;\nexport default App;");
    expect(reply.truncated).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);

    const followUp = requestBody(spy, 1).messages;
    expect(followUp[followUp.length - 2]).toEqual({
      role: "assistant",
      content: "const a = 1;\nconst b",
    });
    expect(followUp[followUp.length - 1].role).toBe("user");
    expect(followUp[followUp.length - 1].content).toMatch(/continue exactly where it stopped/i);
  });

  it("continues an Anthropic reply via assistant prefill", async () => {
    const spy = mockFetchQueue([
      {
        body: {
          model: "claude-opus-4-8",
          stop_reason: "max_tokens",
          content: [{ type: "text", text: "First half of the page \n" }],
        },
      },
      {
        body: {
          model: "claude-opus-4-8",
          stop_reason: "end_turn",
          content: [{ type: "text", text: " and the second half." }],
        },
      },
    ]);
    const reply = await sendChat({ provider: "anthropic", apiKey: "sk-ant" }, [
      { role: "user", content: "write it", attachments: [] },
    ]);
    expect(reply.text).toBe("First half of the page and the second half.");
    expect(reply.truncated).toBe(false);
    const followUp = requestBody(spy, 1).messages;
    expect(followUp[followUp.length - 1]).toEqual({
      role: "assistant",
      content: "First half of the page",
    });
  });

  it("continues a Gemini reply cut off at MAX_TOKENS", async () => {
    const spy = mockFetchQueue([
      {
        body: {
          candidates: [
            { content: { parts: [{ text: "part one, " }] }, finishReason: "MAX_TOKENS" },
          ],
        },
      },
      {
        body: {
          candidates: [{ content: { parts: [{ text: "part two." }] }, finishReason: "STOP" }],
        },
      },
    ]);
    const reply = await sendChat({ provider: "gemini", apiKey: "g" }, [
      { role: "user", content: "write it", attachments: [] },
    ]);
    expect(reply.text).toBe("part one, part two.");
    const followUp = requestBody(spy, 1).contents;
    expect(followUp[followUp.length - 2].role).toBe("model");
    expect(followUp[followUp.length - 2].parts[0].text).toBe("part one, ");
    expect(followUp[followUp.length - 1].role).toBe("user");
  });

  it("stops continuing after the round budget and reports the reply as truncated", async () => {
    const always = {
      body: {
        model: "m",
        choices: [{ message: { content: "x" }, finish_reason: "length" }],
      },
    };
    const spy = mockFetchQueue([always, always, always, always, always]);
    const reply = await sendChat(
      { provider: "custom", baseUrl: "https://llm.example.com/v1", model: "m" },
      [{ role: "user", content: "go", attachments: [] }]
    );
    expect(spy).toHaveBeenCalledTimes(4);
    expect(reply.truncated).toBe(true);
    expect(reply.text).toBe("xxxx");
  });

  it("honors maxContinuations: 0 (the connect-time ping)", async () => {
    const spy = mockFetchQueue([
      { body: { model: "m", choices: [{ message: { content: "ok" }, finish_reason: "length" }] } },
    ]);
    const reply = await sendChat(
      { provider: "custom", baseUrl: "https://llm.example.com/v1", model: "m" },
      [{ role: "user", content: "ping", attachments: [] }],
      undefined,
      { maxTokens: 16, maxContinuations: 0 }
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(reply).toMatchObject({ text: "ok", truncated: true });
  });

  it("steps max_tokens down to the limit the endpoint names", async () => {
    const spy = mockFetchQueue([
      {
        status: 400,
        body: {
          error: {
            message:
              "max_tokens is too large: 16384. This model supports at most 4096 completion tokens.",
          },
        },
      },
      { body: { model: "m", choices: [{ message: { content: "fits now" } }] } },
    ]);
    const reply = await sendChat(
      { provider: "custom", baseUrl: "https://llm.example.com/v1", model: "m" },
      [{ role: "user", content: "go", attachments: [] }]
    );
    expect(reply.text).toBe("fits now");
    expect(requestBody(spy, 0).max_tokens).toBe(16384);
    expect(requestBody(spy, 1).max_tokens).toBe(4096);
  });

  it("switches to max_completion_tokens when the endpoint demands it", async () => {
    const spy = mockFetchQueue([
      {
        status: 400,
        body: {
          error: {
            message:
              "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
          },
        },
      },
      { body: { model: "m", choices: [{ message: { content: "done" } }] } },
    ]);
    const reply = await sendChat(
      { provider: "openai", apiKey: "sk", model: "o4-mini" },
      [{ role: "user", content: "go", attachments: [] }]
    );
    expect(reply.text).toBe("done");
    const second = requestBody(spy, 1);
    expect(second.max_completion_tokens).toBe(16384);
    expect(second.max_tokens).toBeUndefined();
  });

  it("rethrows unrelated 400s instead of retrying", async () => {
    mockFetchQueue([
      { status: 400, body: { error: { message: "messages: role must alternate" } } },
    ]);
    await expect(
      sendChat({ provider: "custom", baseUrl: "https://llm.example.com/v1", model: "m" }, [
        { role: "user", content: "go", attachments: [] },
      ])
    ).rejects.toThrow(/role must alternate/);
  });
});

describe("sendChat reasoning traces", () => {
  afterEach(() => vi.restoreAllMocks());

  function mockFetch(payload: unknown) {
    return vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }) as never);
  }

  it("strips inline <think> blocks from the reply text", async () => {
    mockFetch({
      model: "minimax-m3",
      choices: [
        {
          message: { content: "<think>plan the timer component</think>Here is your timer." },
          finish_reason: "stop",
        },
      ],
    });
    const reply = await sendChat(
      { provider: "custom", baseUrl: "https://llm.example.com/v1", model: "minimax-m3" },
      [{ role: "user", content: "make a timer", attachments: [] }]
    );
    expect(reply.text).toBe("Here is your timer.");
  });

  it("stitches a think block split across a continuation, then strips it", async () => {
    let call = 0;
    const rounds = [
      {
        choices: [
          { message: { content: "<think>sketch:\ntry {" }, finish_reason: "length" },
        ],
      },
      {
        choices: [
          {
            message: {
              content:
                "\n} catch {}\n</think>Here you go:\n\n```jsx\nexport default function PomodoroTimer() {\n  const [s, setS] = useState(1500);\n  return <div className=\"timer\">{s}</div>;\n}\n```",
            },
            finish_reason: "stop",
          },
        ],
      },
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify(rounds[call++]), { status: 200 })
    );
    const reply = await sendChat(
      { provider: "custom", baseUrl: "https://llm.example.com/v1", model: "minimax-m3" },
      [{ role: "user", content: "make a timer", attachments: [] }]
    );
    expect(reply.truncated).toBe(false);
    expect(reply.text).not.toContain("think>");
    expect(reply.text).not.toContain("sketch");
    expect(reply.text).toContain("export default function PomodoroTimer");
  });

  it("falls back to the reasoning when the model never produced an answer", async () => {
    mockFetch({
      choices: [
        {
          message: { content: "<think>I was still planning when the tokens ran out" },
          finish_reason: "stop",
        },
      ],
    });
    const reply = await sendChat(
      { provider: "custom", baseUrl: "https://llm.example.com/v1", model: "m" },
      [{ role: "user", content: "go", attachments: [] }]
    );
    expect(reply.text).toBe("I was still planning when the tokens ran out");
  });
});

describe("base URL handling", () => {
  it("normalizes pasted completions paths and trailing slashes", () => {
    expect(normalizeBaseUrl("https://ollama.com/v1/")).toBe("https://ollama.com/v1");
    expect(normalizeBaseUrl("https://api.example.com/v1/chat/completions")).toBe(
      "https://api.example.com/v1"
    );
    expect(normalizeBaseUrl("  http://localhost:11434/v1//  ")).toBe("http://localhost:11434/v1");
  });

  it("recognizes local and LAN addresses", () => {
    expect(isLocalUrl("http://localhost:11434/v1")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1:1234/v1")).toBe(true);
    expect(isLocalUrl("http://192.168.1.20:11434/v1")).toBe(true);
    expect(isLocalUrl("https://ollama.com/v1")).toBe(false);
    expect(isLocalUrl("not a url")).toBe(false);
  });

  it("strips a pasted /v1/messages path down to the API root", () => {
    expect(normalizeBaseUrl("https://gateway.example.com/v1/messages")).toBe(
      "https://gateway.example.com"
    );
  });

  it("proposes dropping a trailing /v1 for Anthropic-style endpoints", () => {
    expect(anthropicBaseUrlCandidates("https://gateway.example.com/v1")).toEqual([
      "https://gateway.example.com/v1",
      "https://gateway.example.com",
    ]);
    expect(anthropicBaseUrlCandidates("https://gateway.example.com")).toEqual([
      "https://gateway.example.com",
    ]);
  });

  it("proposes likely corrections for a wrong base URL", () => {
    expect(baseUrlCandidates("https://ollama.com/api/v1")).toEqual([
      "https://ollama.com/api/v1",
      "https://ollama.com/v1",
    ]);
    expect(baseUrlCandidates("http://localhost:11434")).toEqual([
      "http://localhost:11434",
      "http://localhost:11434/v1",
    ]);
  });
});

describe("testBackend", () => {
  afterEach(() => vi.restoreAllMocks());

  it("recovers from a wrong Ollama cloud base URL by probing the /v1 root", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url) === "https://ollama.com/v1/chat/completions") {
        return new Response(
          JSON.stringify({ model: "minimax-m3:cloud", choices: [{ message: { content: "ok" } }] }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: "path not found" }), { status: 404 });
    });
    const result = await testBackend({
      provider: "custom",
      baseUrl: "https://ollama.com/api/v1",
      model: "minimax-m3:cloud",
      apiKey: "key",
    });
    expect(result).toEqual({ ok: true, baseUrl: "https://ollama.com/v1", model: "minimax-m3:cloud" });
  });

  it("recovers from a pasted /v1 root on an Anthropic-style custom endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url) === "https://gateway.example.com/v1/messages") {
        return new Response(
          JSON.stringify({ model: "claude-opus-4-8", content: [{ type: "text", text: "ok" }] }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    });
    const result = await testBackend({
      provider: "custom-anthropic",
      baseUrl: "https://gateway.example.com/v1",
      model: "claude-opus-4-8",
      apiKey: "key",
    });
    expect(result).toEqual({
      ok: true,
      baseUrl: "https://gateway.example.com",
      model: "claude-opus-4-8",
    });
  });

  it("fails fast on non-404 errors without probing other URLs", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
        status: 401,
      }) as never
    );
    const result = await testBackend({
      provider: "custom",
      baseUrl: "https://llm.example.com",
      model: "m",
      apiKey: "bad",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid api key/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns the original 404 when no candidate answers", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ error: "path not found" }), { status: 404 })
    );
    const result = await testBackend({
      provider: "custom",
      baseUrl: "https://llm.example.com/api",
      model: "m",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/404/);
  });
});
