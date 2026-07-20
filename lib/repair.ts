
import type { BackendConfig, SendOptions } from "@/lib/backends/chat";
import { sendChat } from "@/lib/backends/chat";
import type { CanonicalMessage } from "@/lib/chat/canonical";

export type RepairKind = "html" | "jsx";

const SYSTEM_PROMPT_BASE =
  "You are a code-repair tool inside HyperVault. You receive ONE artifact that " +
  "fails to render because of a mistake in the code, and your only job is to make " +
  "it render.\n\n" +
  "Rules — follow every one:\n" +
  "1. Fix ONLY what prevents the code from parsing and rendering: syntax errors, " +
  "unbalanced braces/parentheses/brackets, unclosed tags or strings, a missing " +
  "return, a stray or duplicated token, a typo'd identifier. When the browser's " +
  "actual error message is given below with the source, you may also fix the " +
  "specific runtime bug that throws THAT error (e.g. reading a property off " +
  "undefined, a bad array index, a hook called conditionally, a variable used " +
  "before it's defined) — but stop there; do not go hunting for other bugs.\n" +
  "2. Do NOT add features, styling, or behavior. Do NOT finish work that was left " +
  "unimplemented. If a feature is only half-built and its incompleteness is what " +
  "breaks rendering, replace the broken part with the smallest safe stub (an empty " +
  "handler, a placeholder element, a no-op) so the page renders — nothing more.\n" +
  "3. Preserve all existing code, comments, text, and intent. Keep the same " +
  "structure and names. Change as few characters as possible.\n" +
  "4. Return the COMPLETE corrected file, from its first character to its last. " +
  "Never abbreviate with comments like \"// unchanged\".\n" +
  "5. Output ONLY the corrected code. No markdown fences, no explanation, no " +
  "preamble, no trailing commentary.";

const KIND_HINT: Record<RepairKind, string> = {
  html: "The artifact is a standalone HTML page (it may embed <script>/<style>).",
  jsx: "The artifact is a React/JSX (or TSX) component that HyperVault runs in the " +
    "browser via Babel Standalone. Bare hooks (useState, …) and unknown imports are " +
    "provided by the runtime, so do not add import lines to satisfy them — assume " +
    "React and its hooks are already in scope.",
};

export function buildRepairMessages(
  brokenSource: string,
  kind: RepairKind,
  title: string,
  renderError?: string | null
): { system: string; messages: CanonicalMessage[] } {
  const system = `${SYSTEM_PROMPT_BASE}\n\n${KIND_HINT[kind]}`;
  const errorLine = renderError?.trim()
    ? `\n\nThe browser reported this error while rendering it:\n${renderError.trim()}`
    : "";
  const user =
    `Repair this artifact${title ? ` (titled “${title}”)` : ""} so it renders. ` +
    `Return only the corrected ${kind === "jsx" ? "component" : "HTML"} code.${errorLine}\n\n` +
    brokenSource;
  return {
    system,
    messages: [{ role: "user", content: user, attachments: [] }],
  };
}

export function extractRepairedCode(reply: string): string | null {
  if (!reply) return null;
  let out = reply;

  const blocks = Array.from(reply.matchAll(/```[\w-]*[ \t]*\n([\s\S]*?)```/g), (m) => m[1]);
  if (blocks.length > 0) {
    out = blocks.reduce((longest, b) => (b.length > longest.length ? b : longest));
  } else {
    out = out.replace(/^```[\w-]*[ \t]*\n?/m, "").replace(/\n?```[ \t]*$/m, "");
  }

  out = out.replace(/^﻿/, "").trim();
  if (!out) return null;
  return out;
}

export function isUnchanged(before: string, after: string): boolean {
  const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
  return norm(before) === norm(after);
}

export type RepairResult =
  | { ok: true; code: string; model: string; changed: boolean }
  | { ok: false; error: string };

export async function repairArtifactSource(
  backend: BackendConfig,
  brokenSource: string,
  kind: RepairKind,
  title: string,
  renderError?: string | null,
  opts: SendOptions = {}
): Promise<RepairResult> {
  const source = brokenSource.trim();
  if (!source) return { ok: false, error: "There's no source to repair." };

  const { system, messages } = buildRepairMessages(source, kind, title, renderError);

  let reply;
  try {
    reply = await sendChat(backend, messages, system, {
      maxContinuations: 6,
      ...opts,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The repair backend request failed." };
  }

  if (reply.truncated) {
    return {
      ok: false,
      error:
        "The model's fix was cut off by its length limit before the whole file came back. " +
        "Try a backend with a larger output limit, or trim the artifact first.",
    };
  }

  const code = extractRepairedCode(reply.text);
  if (!code) {
    return { ok: false, error: "The model didn't return any code to save." };
  }

  return { ok: true, code, model: reply.model, changed: !isUnchanged(source, code) };
}
