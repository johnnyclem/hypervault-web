import { describe, expect, it } from "vitest";
import {
  authCookieExpirations,
  duplicateCookieNames,
  expireCookieHeader,
  hasSessionCookie,
  hasVerifierCookie,
  isSessionCookieName,
  isVerifierCookieName,
  parseCookieNames,
} from "@/lib/auth-cookies";

const SESSION = "sb-abcdefgh-auth-token";
const CHUNK = "sb-abcdefgh-auth-token.0";
const VERIFIER = "sb-abcdefgh-auth-token-code-verifier";

describe("cookie-name classification", () => {
  it("tells session cookies (and chunks) apart from the PKCE verifier", () => {
    expect(isSessionCookieName(SESSION)).toBe(true);
    expect(isSessionCookieName(CHUNK)).toBe(true);
    expect(isSessionCookieName(VERIFIER)).toBe(false);
    expect(isVerifierCookieName(VERIFIER)).toBe(true);
    expect(isSessionCookieName("theme")).toBe(false);
  });
});

describe("raw Cookie-header parsing", () => {
  it("keeps repeated names — the shadow-cookie fingerprint Next's parser hides", () => {
    const header = `${SESSION}=aaa; theme=dark; ${SESSION}=bbb`;
    expect(parseCookieNames(header)).toEqual([SESSION, "theme", SESSION]);
    expect(duplicateCookieNames(header)).toEqual([SESSION]);
  });

  it("handles empty and absent headers", () => {
    expect(parseCookieNames(null)).toEqual([]);
    expect(duplicateCookieNames(undefined)).toEqual([]);
  });

  it("detects session and verifier presence", () => {
    const names = parseCookieNames(`${VERIFIER}=x; theme=dark`);
    expect(hasVerifierCookie(names)).toBe(true);
    expect(hasSessionCookie(names)).toBe(false);
  });
});

describe("cookie expiration sweep", () => {
  it("builds an expired Set-Cookie line", () => {
    const header = expireCookieHeader(SESSION, { domain: ".claudedamnit.com", secure: true });
    expect(header).toContain(`${SESSION}=;`);
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("Domain=.claudedamnit.com");
    expect(header).toContain("Secure");
  });

  it("expires every sb-* cookie in BOTH scope variants on a known base domain", () => {
    const headers = authCookieExpirations(
      `${SESSION}=aaa; ${VERIFIER}=vvv; theme=dark`,
      "www.claudedamnit.com"
    );
    expect(headers).toHaveLength(4);
    expect(headers.filter((h) => h.includes("Domain=.claudedamnit.com"))).toHaveLength(2);
    expect(headers.some((h) => h.startsWith("theme="))).toBe(false);
  });

  it("sweeps only host-scoped on unknown hosts and dedupes repeated names", () => {
    const headers = authCookieExpirations(`${SESSION}=a; ${SESSION}=b`, "preview.vercel.app");
    expect(headers).toHaveLength(1);
    expect(headers[0]).not.toContain("Domain=");
  });
});
