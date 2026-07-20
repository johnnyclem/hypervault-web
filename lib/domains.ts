export type PortfolioDomain = {
  domain: string;
  tagline: string;
  featured?: boolean;
  available: boolean;
};

export const DOMAIN_PORTFOLIO: PortfolioDomain[] = [
  { domain: "vault.cool", tagline: "The legendary original. you.vault.cool", featured: true, available: true },
  { domain: "agentvault.cloud", tagline: "For agents with their heads in the cloud", available: true },
  { domain: "cleon.wiki", tagline: "For knowledge bases and living documents", available: true },
  { domain: "inkbound.ink", tagline: "For stories, zines, and beautiful writing", available: true },
  { domain: "claudedamnit.com", tagline: "The meme domain. You know who you are.", available: true },
  { domain: "cleon.casa", tagline: "A cozy home for your creations", available: true },
  { domain: "cleon.city", tagline: "Bright lights, big artifacts", available: true },
  { domain: "tinderforai.com", tagline: "Where agents find their match", available: true },
  { domain: "onlywizards.website", tagline: "For spellbinding work only", available: true },
  { domain: "hypervault.store", tagline: "The official HyperVault address", available: true },
  { domain: "ralphy.website", tagline: "Charmingly chaotic, proudly weird", available: true },
  { domain: "permaclaw.com", tagline: "Permanent links with claws", available: true },
  { domain: "bo.dy", tagline: "Where your creations take shape", available: true },
];

export function activeBaseDomains(): string[] {
  const fromEnv = (process.env.NEXT_PUBLIC_VANITY_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DOMAIN_PORTFOLIO.filter((d) => d.available).map((d) => d.domain);
}

export function domainPortfolio(): PortfolioDomain[] {
  const active = new Set(activeBaseDomains());
  const known = DOMAIN_PORTFOLIO.map((d) => ({ ...d, available: active.has(d.domain) }));
  const extras = [...active]
    .filter((domain) => !DOMAIN_PORTFOLIO.some((d) => d.domain === domain))
    .map((domain) => ({ domain, tagline: `Fresh from the portfolio. you.${domain}`, available: true }));
  return [...known, ...extras];
}

export function baseDomainForHost(host: string | null | undefined): string | null {
  const h = (host ?? "").toLowerCase().split(":")[0];
  return activeBaseDomains().find((b) => h === b || h.endsWith(`.${b}`)) ?? null;
}

export function cookieDomainForHost(host: string | null | undefined): string | undefined {
  const base = baseDomainForHost(host);
  return base ? `.${base}` : undefined;
}

export const MAX_PRO_SUBDOMAINS = 10;

export const RESERVED_SUBDOMAINS = new Set([
  "www", "app", "api", "mail", "admin", "root", "dashboard", "vault", "help",
  "support", "docs", "blog", "status", "dev", "staging", "test", "assets",
  "cdn", "static", "hypervault", "billing", "login", "signup", "auth",
]);

const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function validateSubdomain(name: string): { ok: true; name: string } | { ok: false; error: string } {
  const normalized = name.trim().toLowerCase();
  if (normalized.length < 2) return { ok: false, error: "Pick at least 2 characters." };
  if (normalized.length > 63) return { ok: false, error: "Subdomains max out at 63 characters." };
  if (!SUBDOMAIN_RE.test(normalized)) {
    return { ok: false, error: "Use only lowercase letters, numbers, and hyphens (no leading/trailing hyphen)." };
  }
  if (RESERVED_SUBDOMAINS.has(normalized)) return { ok: false, error: `"${normalized}" is reserved.` };
  return { ok: true, name: normalized };
}
