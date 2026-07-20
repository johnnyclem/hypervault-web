
import type { ToolRefinementNeeded, ToolResult } from "@/lib/vendor/smallchat/core/types";

export type IntentCall = { intent: string; args: Record<string, unknown> };

export type ToolResultBlock = {
  intent: string;
  tool: string | null;
  ok: boolean;
  confidence?: number;
  tier?: string;
  content?: unknown;
  error?: string;
  refinement?: {
    question: string;
    options: Array<{ label: string; intent: string; canonical?: string }>;
  };
};

export const MAX_TOOL_ITERATIONS = 4;
const MAX_INTENT_CHARS = 500;
const MAX_RESULT_CHARS = 8_000;

const TOOL_FENCE_RE = /```tool[ \t]*\r?\n/;
const TOOL_RESULT_FENCE_RE = /```tool-result[ \t]*\r?\n/;

function extractFencedJson(text: string, fence: RegExp): { json: string; fenceIndex: number } | null {
  const match = fence.exec(text);
  if (!match) return null;
  const from = match.index + match[0].length;
  const open = text.indexOf("{", from);
  if (open === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      return { json: text.slice(open, i + 1), fenceIndex: match.index };
    }
  }
  return null;
}

export function parseIntentCall(text: string): { call: IntentCall; visibleText: string } | null {
  const extracted = extractFencedJson(text, TOOL_FENCE_RE);
  if (!extracted) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted.json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const intent = typeof obj.intent === "string" ? obj.intent.trim() : "";
  if (!intent || intent.length > MAX_INTENT_CHARS) return null;
  if ("args" in obj && (typeof obj.args !== "object" || obj.args === null || Array.isArray(obj.args))) {
    return null;
  }
  const args = (obj.args as Record<string, unknown> | undefined) ?? {};
  return {
    call: { intent, args },
    visibleText: text.slice(0, extracted.fenceIndex).trim(),
  };
}

function truncate(value: unknown): unknown {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  if (text.length <= MAX_RESULT_CHARS) return value;
  return `${text.slice(0, MAX_RESULT_CHARS)}…[truncated ${text.length - MAX_RESULT_CHARS} chars]`;
}

export function formatToolResultBlock(call: IntentCall, result: ToolResult): string {
  const metadata = (result.metadata ?? {}) as {
    confidence?: number;
    tier?: string;
    resolvedTool?: string;
    providerId?: string;
  };
  const refinement = result.refinement as ToolRefinementNeeded | undefined;
  const block: ToolResultBlock = {
    intent: call.intent,
    tool: resolvedToolLabel(result),
    ok: !result.isError && !refinement,
    ...(typeof metadata.confidence === "number" ? { confidence: Number(metadata.confidence.toFixed(3)) } : {}),
    ...(metadata.tier ? { tier: metadata.tier } : {}),
  };
  if (refinement) {
    block.refinement = {
      question: refinement.question,
      options: refinement.options.map((o) => ({
        label: o.label,
        intent: o.intent,
        ...(o.canonical ? { canonical: o.canonical } : {}),
      })),
    };
  } else if (result.isError) {
    block.error =
      typeof result.content === "string" ? result.content.slice(0, 2_000) : "The tool call failed.";
  } else {
    block.content = truncate(result.content);
  }
  return "```tool-result\n" + JSON.stringify(block) + "\n```";
}

function resolvedToolLabel(result: ToolResult): string | null {
  const metadata = (result.metadata ?? {}) as Record<string, unknown>;
  const proof = metadata.proof as { resolvedTool?: string } | undefined;
  const tool =
    (typeof metadata.resolvedTool === "string" && metadata.resolvedTool) ||
    (proof && typeof proof.resolvedTool === "string" && proof.resolvedTool) ||
    null;
  return tool;
}

export function parseToolResultBlock(text: string): ToolResultBlock | null {
  const extracted = extractFencedJson(text, TOOL_RESULT_FENCE_RE);
  if (!extracted) return null;
  try {
    const parsed = JSON.parse(extracted.json) as ToolResultBlock;
    if (typeof parsed.intent !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function toolSystemPrompt(header: string): string {
  return `## Tools
You can act through a semantic tool dispatcher. Below are the capability AREAS
available — not a tool list. You never choose or name a tool; you describe what
you want done and the dispatcher resolves the exact tool. Reason about the
user's goal first, then, only if an action is actually needed, express it.

<capabilities>
${header}
</capabilities>

To call a tool, end your reply with exactly one fenced block:

\`\`\`tool
{"intent": "<short imperative phrase describing the action>", "args": {"<name>": "<value>"}}
\`\`\`

Rules:
- Describe WHAT you want done in plain English ("fetch the contents of a url",
  "save html to the vault"). The dispatcher resolves the best matching tool
  semantically — you do not know or need exact tool names, and you must not
  invent or guess them. The areas above are orientation, not an inventory to
  enumerate for the user.
- "args" is one JSON object of the arguments the action needs.
- At most one tool block per reply, at the very end, with nothing after it.
- You will then receive a \`\`\`tool-result\`\`\` message. Use its "content" to
  continue. If "ok" is false, explain the problem or try a rephrased intent
  ONCE — do not repeat the same intent, and never paste a suggested option's
  label back as a new intent.
- If a result contains "refinement", the dispatcher could not decide which tool
  you meant. STOP calling tools: list the offered options to the user in plain
  text and ask which one they want. Do not pick one yourself and do not retry —
  the user chooses, and the app runs their choice directly.
- When no tool is needed, reply normally with no tool block.`;
}
