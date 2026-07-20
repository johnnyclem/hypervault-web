
import type { ToolResult } from "@/lib/vendor/smallchat/core/types";
import type { ToolRuntime } from "@/lib/vendor/smallchat/runtime/runtime";

export type ToolChoice = {
  canonical: string;
  providerId: string;
  toolName: string;
  label: string;
};

const STOPWORDS = new Set([
  "a", "an", "the", "all", "any", "some", "my", "our", "your", "their",
  "please", "just", "of", "for", "to", "in", "on", "and", "me", "us",
  "this", "that", "these", "those", "it", "let", "lets", "can", "could",
  "would", "show", "get",
]);

function isAliasSelector(canonical: string): boolean {
  return canonical.includes("~alias~");
}

function toolPartOf(canonical: string): string {
  const dot = canonical.indexOf(".");
  return dot === -1 ? canonical : canonical.slice(dot + 1);
}

function providerPartOf(canonical: string): string {
  const dot = canonical.indexOf(".");
  return dot === -1 ? "" : canonical.slice(0, dot);
}

export function humanizeToolName(canonical: string): string {
  return humanize(toolPartOf(canonical));
}

function humanize(toolName: string): string {
  return toolName
    .replace(/[_:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
}

export function listToolkitTools(runtime: ToolRuntime): ToolChoice[] {
  const seen = new Set<string>();
  const out: ToolChoice[] = [];
  for (const selector of runtime.selectorTable.all()) {
    const canonical = selector.canonical;
    if (isAliasSelector(canonical) || seen.has(canonical)) continue;
    if (runtime.context.classesForSelector(canonical).length === 0) continue;
    seen.add(canonical);
    const toolName = toolPartOf(canonical);
    out.push({
      canonical,
      providerId: providerPartOf(canonical),
      toolName,
      label: humanize(toolName),
    });
  }
  return out;
}

export async function dispatchExact(
  runtime: ToolRuntime,
  canonical: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const selector = runtime.selectorTable.get(canonical);
  if (!selector) {
    return { content: `That tool ("${canonical}") is no longer in the toolkit.`, isError: true };
  }
  for (const toolClass of runtime.context.classesForSelector(canonical)) {
    const imp = toolClass.resolveSelector(selector);
    if (imp) {
      try {
        return await imp.execute(args);
      } catch (err) {
        return { content: err instanceof Error ? err.message : "The tool call failed.", isError: true };
      }
    }
  }
  return { content: `That tool ("${canonical}") is no longer in the toolkit.`, isError: true };
}

export type LexicalResolution =
  | { kind: "resolved"; canonical: string; toolName: string }
  | { kind: "ambiguous"; canonicals: string[] }
  | { kind: "none" };

export function lexicalResolve(runtime: ToolRuntime, intent: string): LexicalResolution {
  const intentTokens = new Set(tokenize(intent));
  if (intentTokens.size === 0) return { kind: "none" };

  const matches: string[] = [];
  for (const tool of listToolkitTools(runtime)) {
    const nameTokens = tokenize(tool.toolName);
    if (nameTokens.length === 0) continue;
    if (nameTokens.every((t) => intentTokens.has(t))) {
      matches.push(tool.canonical);
    }
  }

  if (matches.length === 0) return { kind: "none" };
  if (matches.length === 1) {
    return { kind: "resolved", canonical: matches[0], toolName: toolPartOf(matches[0]) };
  }
  let best = matches[0];
  let bestLen = tokenize(toolPartOf(best)).length;
  let tie = false;
  for (const canonical of matches.slice(1)) {
    const len = tokenize(toolPartOf(canonical)).length;
    if (len > bestLen) {
      best = canonical;
      bestLen = len;
      tie = false;
    } else if (len === bestLen) {
      tie = true;
    }
  }
  if (tie) return { kind: "ambiguous", canonicals: matches };
  return { kind: "resolved", canonical: best, toolName: toolPartOf(best) };
}
