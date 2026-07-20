
const MAX_TITLE_CHARS = 80;

export const CHAT_TRANSCRIPT_MARKER = "hypervault-chat-transcript";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function shareTitle(content: string, sourcePrompt?: string): string {
  const fromPrompt = sourcePrompt?.replace(/\s+/g, " ").trim();
  if (fromPrompt) return fromPrompt.slice(0, MAX_TITLE_CHARS);
  const firstLine = content
    .split("\n")
    .map((l) => l.replace(/^[#>\-*\s]+/, "").trim())
    .find((l) => l.length > 0);
  return (firstLine ?? "Chat reply").slice(0, MAX_TITLE_CHARS);
}

export function wrapTextAsHtmlPage(text: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="${CHAT_TRANSCRIPT_MARKER}" content="1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { max-width: 42rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem;
    font: 17px/1.65 ui-serif, Georgia, serif; }
  h1 { font-size: 1.3rem; line-height: 1.3; margin: 0 0 1.5rem;
    font-family: system-ui, sans-serif; }
  article { white-space: pre-wrap; overflow-wrap: break-word; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<article>${escapeHtml(text)}</article>
</body>
</html>`;
}
