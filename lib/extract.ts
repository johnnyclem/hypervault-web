import { activeBaseDomains, DOMAIN_PORTFOLIO } from "@/lib/domains";
import { SOURCE_PROMPT_META_NAME } from "@/lib/pwa";
import { appUrl } from "@/lib/utils";


export function isHyperVaultHost(hostname: string | null | undefined): boolean {
  const host = (hostname ?? "").toLowerCase().split(":")[0];
  if (!host) return false;

  let ownHost = "";
  try {
    ownHost = new URL(appUrl()).hostname.toLowerCase();
  } catch {
  }
  if (ownHost && host === ownHost) return true;

  const bases = new Set([...DOMAIN_PORTFOLIO.map((d) => d.domain), ...activeBaseDomains()]);
  return [...bases].some((base) => host === base || host.endsWith(`.${base}`));
}

export function artifactSlugFromUrl(url: URL): string | null {
  const canonical = url.pathname.match(/^\/a\/([^/]+)\/?$/);
  const raw = canonical?.[1] ?? url.pathname.split("/").filter(Boolean).pop() ?? "";
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function unescapeAttr(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function findSourcePromptMeta(html: string): string | null {
  const name = SOURCE_PROMPT_META_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["'](.*?)["']`, "is"),
    new RegExp(`<meta[^>]*content=["'](.*?)["'][^>]*name=["']${name}["']`, "is"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return unescapeAttr(match[1]);
  }
  return null;
}
