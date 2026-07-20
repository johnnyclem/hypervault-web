
import { detectJsx } from "@/lib/jsx";
import { stripThinking } from "@/lib/chat/thinking";

export type ChatArtifact = {
  content: string;
  kind: "html" | "jsx";
  title: string | null;
};

const MIN_ARTIFACT_CHARS = 60;

const HTML_LANGS = new Set(["html", "htm", "xhtml", "svg", "xml"]);
const JSX_LANGS = new Set(["jsx", "tsx", "react"]);
const SCRIPT_LANGS = new Set(["", "js", "javascript", "ts", "typescript"]);

function isFullHtmlDocument(code: string): boolean {
  const trimmed = code.trimStart();
  return /^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed);
}

function looksLikeHtmlFragment(code: string): boolean {
  const trimmed = code.trim();
  return (
    trimmed.startsWith("<") &&
    /<\/[a-z][\w-]*\s*>/i.test(trimmed) &&
    /<(body|head|div|main|section|article|style|script|svg|canvas|form|table|nav|header|footer|p|h[1-6])\b/i.test(trimmed)
  );
}

function classify(code: string, lang: string): ChatArtifact["kind"] | null {
  if (HTML_LANGS.has(lang)) return "html";
  if (JSX_LANGS.has(lang)) return "jsx";
  if (!SCRIPT_LANGS.has(lang)) return null;
  if (isFullHtmlDocument(code)) return "html";
  if (detectJsx(code).isJsx) return "jsx";
  if (lang === "" && looksLikeHtmlFragment(code)) return "html";
  return null;
}

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

export function guessArtifactTitle(artifact: Pick<ChatArtifact, "content" | "kind">): string | null {
  const { content, kind } = artifact;
  if (kind === "html") {
    const fromTitle = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const fromH1 = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
    const guess = stripTags(fromTitle ?? fromH1 ?? "");
    return guess ? guess.slice(0, 80) : null;
  }
  const name =
    content.match(/\bexport\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Z][\w$]*)/)?.[1] ??
    content.match(/\bfunction\s+([A-Z][\w$]*)\s*\(/)?.[1] ??
    content.match(/\b(?:const|let|var)\s+([A-Z][\w$]*)\s*=\s*(?:\([^)]*\)|[\w$]+)\s*=>/)?.[1] ??
    null;
  return name ? name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").slice(0, 80) : null;
}

function trailingOpenFence(
  message: string,
  after: number
): { lang: string; code: string } | null {
  const tail = message.slice(after);
  const open = /```([\w-]*)[ \t]*\r?\n([\s\S]*)$/.exec(tail);
  if (!open) return null;
  const code = open[2].trim();
  return code ? { lang: open[1].toLowerCase(), code } : null;
}

export function extractChatArtifact(message: string): ChatArtifact | null {
  if (!message) return null;
  const visible = stripThinking(message).text;
  if (visible.length < MIN_ARTIFACT_CHARS) return null;

  const fences = Array.from(visible.matchAll(/```([\w-]*)[ \t]*\n([\s\S]*?)```/g));
  const last = fences[fences.length - 1];
  const openTail = trailingOpenFence(visible, last ? (last.index ?? 0) + last[0].length : 0);
  if (fences.length > 0 || openTail) {
    let best: ChatArtifact | null = null;
    const blocks = [
      ...fences.map((m) => ({ lang: m[1].toLowerCase(), code: m[2].trim() })),
      ...(openTail ? [openTail] : []),
    ];
    for (const block of blocks) {
      if (block.code.length < MIN_ARTIFACT_CHARS) continue;
      const kind = classify(block.code, block.lang);
      if (!kind) continue;
      if (!best || block.code.length > best.content.length) {
        best = { content: block.code, kind, title: null };
      }
    }
    if (best) best.title = guessArtifactTitle(best);
    return best;
  }

  const bare = visible.trim();
  if (bare.length < MIN_ARTIFACT_CHARS) return null;
  if (isFullHtmlDocument(bare)) {
    const artifact: ChatArtifact = { content: bare, kind: "html", title: null };
    artifact.title = guessArtifactTitle(artifact);
    return artifact;
  }
  const startsLikeCode = /^(import\s|export\s|function\s|const\s|let\s|var\s|class\s|<|\/\/|\/\*)/.test(bare);
  if (startsLikeCode && detectJsx(bare).isJsx) {
    const artifact: ChatArtifact = { content: bare, kind: "jsx", title: null };
    artifact.title = guessArtifactTitle(artifact);
    return artifact;
  }
  return null;
}
