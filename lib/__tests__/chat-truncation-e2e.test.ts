import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sendChat } from "@/lib/backends/chat";
import { extractChatArtifact } from "@/lib/chat/artifact";


const COMPONENT = `export default function PomodoroTimer() {
  const [seconds, setSeconds] = useState(1500);
  return <div className="timer">{seconds}</div>;
}`;

let baseUrl = "";
const requests: Array<Record<string, unknown>> = [];
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw);
    requests.push(body);
    const isContinuation = body.messages.some((m: { role: string }) => m.role === "assistant");
    const payload = isContinuation
      ? {
          model: "minimax-m3",
          choices: [
            {
              message: {
                content: `\n} catch {}\n</think>Here you go:\n\n\`\`\`jsx\n${COMPONENT}\n\`\`\``,
              },
              finish_reason: "stop",
            },
          ],
        }
      : {
          model: "minimax-m3",
          choices: [
            {
              message: { content: "<think>Let me sketch it:\n// ... etc\ntry {" },
              finish_reason: "length",
            },
          ],
        };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(payload));
  });
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("truncated reasoning reply over real HTTP", () => {
  it("auto-continues, strips the trace, and the artifact extractor finds the full component", async () => {
    const reply = await sendChat(
      { provider: "custom", baseUrl, model: "minimax-m3" },
      [{ role: "user", content: "make a pomodoro timer", attachments: [] }]
    );
    expect(requests).toHaveLength(2);
    expect(reply.truncated).toBe(false);
    expect(reply.text).not.toContain("think>");
    expect(reply.text).not.toContain("// ... etc");

    const artifact = extractChatArtifact(reply.text);
    expect(artifact?.kind).toBe("jsx");
    expect(artifact?.content).toBe(COMPONENT);
    expect(artifact?.title).toBe("Pomodoro Timer");
  });
});
