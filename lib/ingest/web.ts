import { IngestError, clampMemoryContent } from "./limits";


const FETCH_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 3_000_000;
const MAX_REDIRECTS = 4;
const USER_AGENT = "HyperVaultBot/1.0 (+https://claudedamnit.com; knowledgebase import)";

export function checkPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new IngestError("That doesn't look like a valid URL.", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new IngestError("Only http(s) URLs can be imported.", 400);
  }
  if (isBlockedHost(url.hostname)) {
    throw new IngestError("That URL points at a private or local address, which can't be imported.", 400);
  }
  return url;
}

export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  if (h.includes(":")) {
    return h === "::" || h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
  }
  return false;
}

export async function fetchPublicUrl(rawUrl: string): Promise<{ finalUrl: string; contentType: string; body: string }> {
  let url = checkPublicHttpUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain,text/markdown,*/*;q=0.5" },
      });
    } catch {
      throw new IngestError("Couldn't reach that URL — it may be down or blocking requests.");
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new IngestError("That URL redirected without a destination.");
      url = checkPublicHttpUrl(new URL(location, url).toString());
      continue;
    }
    if (!res.ok) {
      throw new IngestError(`That URL responded with HTTP ${res.status} — nothing to import.`);
    }

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const body = await readBodyCapped(res);
    return { finalUrl: url.toString(), contentType, body };
  }
  throw new IngestError("Too many redirects — gave up importing that URL.");
}

async function readBodyCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      void reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(Math.min(received, MAX_BODY_BYTES));
  let offset = 0;
  for (const c of chunks) {
    merged.set(c.subarray(0, merged.length - offset), offset);
    offset += c.byteLength;
    if (offset >= merged.length) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "'",
  lsquo: "'",
  rdquo: "”",
  ldquo: "“",
  copy: "©",
  trade: "™",
  reg: "®",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function safeFromCodePoint(cp: number): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg|iframe|head|nav|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi, "");

  s = s
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => `\n\n${"#".repeat(Number(n))} `)
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|ul|ol|tr|table|blockquote|pre|figure|main|header|aside|dd|dt)>/gi, "\n")
    .replace(/<(p|blockquote|pre|table)[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t");

  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);

  return s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractPageMeta(html: string): { title: string | null; description: string | null } {
  const title =
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)/i)?.[1] ??
    null;
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)/i)?.[1] ??
    null;
  return {
    title: title ? decodeEntities(title).replace(/\s+/g, " ").trim() || null : null,
    description: description ? decodeEntities(description).replace(/\s+/g, " ").trim() || null : null,
  };
}

export type WebMemory = { title: string; content: string; tags: string[] };

export async function scrapeUrlToMemory(rawUrl: string, capturedAt: Date = new Date()): Promise<WebMemory> {
  const { finalUrl, contentType, body } = await fetchPublicUrl(rawUrl);
  const hostname = new URL(finalUrl).hostname.replace(/^www\./, "");

  let title: string;
  let text: string;
  let description: string | null = null;

  if (contentType.includes("html") || (!contentType && /<html|<body|<div/i.test(body))) {
    const meta = extractPageMeta(body);
    title = meta.title ?? finalUrl;
    description = meta.description;
    text = htmlToText(body);
  } else if (contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml")) {
    title = decodeURIComponent(finalUrl.split("/").filter(Boolean).pop() ?? finalUrl);
    text = body.trim();
  } else {
    throw new IngestError(
      `That URL serves ${contentType || "unknown content"} — only web pages and text files can be scraped. For documents, use the file import.`,
      415
    );
  }

  if (!text.trim()) {
    throw new IngestError("No readable text found on that page — it may render entirely with JavaScript.");
  }

  const entry = [
    `# ${title}`,
    "",
    `Source: ${finalUrl}`,
    `Captured: ${capturedAt.toISOString().slice(0, 10)}`,
    ...(description ? ["", `> ${description}`] : []),
    "",
    "---",
    "",
    text,
  ].join("\n");

  return {
    title,
    content: clampMemoryContent(entry),
    tags: [hostname],
  };
}
