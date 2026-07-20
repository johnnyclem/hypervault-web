import { cookieDomainForHost } from "@/lib/domains";


export function isSessionCookieName(name: string): boolean {
  return name.startsWith("sb-") && name.includes("-auth-token") && !name.includes("code-verifier");
}

export function isVerifierCookieName(name: string): boolean {
  return name.startsWith("sb-") && name.includes("code-verifier");
}

export function isSupabaseCookieName(name: string): boolean {
  return name.startsWith("sb-");
}

export function parseCookieNames(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(";")
    .map((part) => part.split("=")[0]?.trim() ?? "")
    .filter(Boolean);
}

export function duplicateCookieNames(header: string | null | undefined): string[] {
  const seen = new Map<string, number>();
  for (const name of parseCookieNames(header)) {
    seen.set(name, (seen.get(name) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}

export function hasSessionCookie(names: string[]): boolean {
  return names.some(isSessionCookieName);
}

export function hasVerifierCookie(names: string[]): boolean {
  return names.some(isVerifierCookieName);
}

export function expireCookieHeader(name: string, opts: { domain?: string; secure?: boolean } = {}): string {
  const parts = [
    `${name}=`,
    "Path=/",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
    "SameSite=Lax",
  ];
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export function authCookieExpirations(
  cookieHeader: string | null | undefined,
  host: string | null | undefined,
  opts: { secure?: boolean } = {}
): string[] {
  const names = [...new Set(parseCookieNames(cookieHeader).filter(isSupabaseCookieName))];
  const domain = cookieDomainForHost(host);
  const headers: string[] = [];
  for (const name of names) {
    headers.push(expireCookieHeader(name, { secure: opts.secure }));
    if (domain) headers.push(expireCookieHeader(name, { domain, secure: opts.secure }));
  }
  return headers;
}
