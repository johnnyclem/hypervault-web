import { appUrl } from "@/lib/utils";

export type ArtifactMetaInput = {
  slug: string;
  title: string;
  isPwa: boolean;
  sourcePrompt?: string | null;
};

export const SOURCE_PROMPT_META_MAX = 4_000;

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function insertInHead(html: string, block: string): string {
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const insertAt = headMatch.index + headMatch[0].length;
    return html.slice(0, insertAt) + block + html.slice(insertAt);
  }

  const htmlTagMatch = html.match(/<html[^>]*>/i);
  if (htmlTagMatch && htmlTagMatch.index !== undefined) {
    const insertAt = htmlTagMatch.index + htmlTagMatch[0].length;
    return html.slice(0, insertAt) + `<head>${block}</head>` + html.slice(insertAt);
  }

  return `<head>${block}</head>\n` + html;
}

export const SOURCE_PROMPT_META_NAME = "hypervault-source-prompt";

export function iconInitial(title: string): string {
  const match = (title || "").match(/[a-z0-9]/i);
  return (match ? match[0] : "#").toUpperCase();
}

export const MAX_ICON_GLYPH_CHARS = 2;

export function normalizeIconGlyph(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const glyph = Array.from(raw.trim()).slice(0, MAX_ICON_GLYPH_CHARS).join("");
  return glyph.length > 0 ? glyph : null;
}

export function iconGlyph(icon: string | null | undefined, title: string): string {
  return normalizeIconGlyph(icon) ?? iconInitial(title);
}

export function iconGradient(seed: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return [`hsl(${hue} 85% 62%)`, `hsl(${(hue + 42) % 360} 80% 46%)`];
}

export function artifactIconUrl(slug: string, size: number): string {
  return `${appUrl()}/a/${encodeURIComponent(slug)}/icon?size=${size}`;
}

export function injectSourcePromptMeta(html: string, sourcePrompt: string): string {
  const tag = `<meta name="${SOURCE_PROMPT_META_NAME}" content="${escapeAttr(sourcePrompt)}" />`;
  return insertInHead(html, `\n${tag}\n`);
}

export function injectArtifactMeta(html: string, meta: ArtifactMetaInput): string {
  const base = appUrl();
  const pageUrl = `${base}/a/${meta.slug}`;
  const title = escapeAttr(meta.title || "HyperVault Artifact");

  const parts: string[] = [];

  const prompt = meta.sourcePrompt?.trim();
  if (prompt && !/name=["']hypervault-source-prompt["']/i.test(html)) {
    parts.push(
      `<meta name="${SOURCE_PROMPT_META_NAME}" content="${escapeAttr(prompt.slice(0, SOURCE_PROMPT_META_MAX))}" />`
    );
  }

  if (!/<link[^>]+rel=["'][^"']*\bicon\b[^"']*["']/i.test(html)) {
    parts.push(`<link rel="icon" href="${escapeAttr(artifactIconUrl(meta.slug, 192))}" />`);
  }

  if (!/property=["']og:title["']/i.test(html)) {
    parts.push(
      `<meta property="og:title" content="${title}" />`,
      `<meta property="og:description" content="Saved with HyperVault — your personal flight deck for everything your AI creates." />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:url" content="${escapeAttr(pageUrl)}" />`,
      `<meta property="og:image" content="${escapeAttr(base)}/og.png" />`,
      `<meta name="twitter:card" content="summary_large_image" />`
    );
  }

  if (meta.isPwa) {
    parts.push(
      `<link rel="manifest" href="/api/manifest/${encodeURIComponent(meta.slug)}" crossorigin="use-credentials" />`,
      `<meta name="theme-color" content="#09090b" />`,
      `<meta name="mobile-web-app-capable" content="yes" />`,
      `<meta name="apple-mobile-web-app-capable" content="yes" />`,
      `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`,
      `<meta name="apple-mobile-web-app-title" content="${title}" />`
    );
    if (!/rel=["']apple-touch-icon["']/i.test(html)) {
      parts.push(`<link rel="apple-touch-icon" href="${escapeAttr(artifactIconUrl(meta.slug, 180))}" />`);
    }
  }

  if (parts.length === 0) return html;
  return insertInHead(html, `\n${parts.join("\n")}\n`);
}

export function artifactManifest(meta: { slug: string; title: string }) {
  return {
    name: meta.title || "HyperVault Artifact",
    short_name: (meta.title || "Artifact").slice(0, 24),
    start_url: `/a/${meta.slug}`,
    scope: `/a/${meta.slug}`,
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: artifactIconUrl(meta.slug, 192), sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: artifactIconUrl(meta.slug, 512), sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  };
}
