import { afterEach, describe, expect, it } from "vitest";
import {
  activeBaseDomains,
  baseDomainForHost,
  cookieDomainForHost,
  domainPortfolio,
  MAX_PRO_SUBDOMAINS,
  validateSubdomain,
} from "@/lib/domains";

const ENV_KEY = "NEXT_PUBLIC_VANITY_DOMAINS";
const originalEnv = process.env[ENV_KEY];

afterEach(() => {
  if (originalEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalEnv;
});

describe("validateSubdomain", () => {
  it("accepts simple names and normalizes case/whitespace", () => {
    expect(validateSubdomain("  Nova ")).toEqual({ ok: true, name: "nova" });
    expect(validateSubdomain("my-cool-vault2")).toEqual({ ok: true, name: "my-cool-vault2" });
  });

  it("rejects names that are too short or too long", () => {
    expect(validateSubdomain("a").ok).toBe(false);
    expect(validateSubdomain("a".repeat(64)).ok).toBe(false);
  });

  it("rejects invalid characters and hyphen placement", () => {
    expect(validateSubdomain("no spaces").ok).toBe(false);
    expect(validateSubdomain("-leading").ok).toBe(false);
    expect(validateSubdomain("trailing-").ok).toBe(false);
    expect(validateSubdomain("dots.not.ok").ok).toBe(false);
  });

  it("rejects reserved names", () => {
    for (const reserved of ["www", "api", "admin", "vault"]) {
      expect(validateSubdomain(reserved).ok).toBe(false);
    }
  });
});

describe("MAX_PRO_SUBDOMAINS", () => {
  it("caps Pro accounts at 10 subdomains, matching the DB trigger", () => {
    expect(MAX_PRO_SUBDOMAINS).toBe(10);
  });
});

describe("activeBaseDomains / domainPortfolio", () => {
  it("defaults to every claimable portfolio domain", () => {
    delete process.env[ENV_KEY];
    const domains = activeBaseDomains();
    expect(domains).toContain("vault.cool");
    expect(domains).toContain("agentvault.cloud");
    expect(domains).toContain("claudedamnit.com");
    expect(domains).toContain("cleon.casa");
    expect(domains).toContain("tinderforai.com");
    expect(domains).toContain("permaclaw.com");
  });

  it("parses the env list", () => {
    process.env[ENV_KEY] = "vault.cool, Cleon.Casa ,";
    expect(activeBaseDomains()).toEqual(["vault.cool", "cleon.casa"]);
  });

  it("marks portfolio availability from the env list", () => {
    process.env[ENV_KEY] = "vault.cool,cleon.casa";
    const portfolio = domainPortfolio();
    const byDomain = Object.fromEntries(portfolio.map((d) => [d.domain, d.available]));
    expect(byDomain["vault.cool"]).toBe(true);
    expect(byDomain["cleon.casa"]).toBe(true);
    expect(byDomain["tinderforai.com"]).toBe(false);
  });

  it("includes env-activated domains missing from the static list", () => {
    process.env[ENV_KEY] = "vault.cool,vault.wtf";
    const extra = domainPortfolio().find((d) => d.domain === "vault.wtf");
    expect(extra?.available).toBe(true);
  });
});

describe("baseDomainForHost / cookieDomainForHost", () => {
  it("matches the apex, www, and vanity subdomains, ignoring case and port", () => {
    expect(baseDomainForHost("claudedamnit.com")).toBe("claudedamnit.com");
    expect(baseDomainForHost("www.claudedamnit.com")).toBe("claudedamnit.com");
    expect(baseDomainForHost("Clem.ClaudeDamnit.com:443")).toBe("claudedamnit.com");
    expect(baseDomainForHost("clem.vault.cool")).toBe("vault.cool");
  });

  it("returns null for hosts outside the portfolio", () => {
    expect(baseDomainForHost("localhost")).toBeNull();
    expect(baseDomainForHost("hypervault.vercel.app")).toBeNull();
    expect(baseDomainForHost("evilclaudedamnit.com")).toBeNull();
    expect(baseDomainForHost(null)).toBeNull();
  });

  it("scopes cookies to the base domain only on vanity hosts", () => {
    expect(cookieDomainForHost("clem.claudedamnit.com")).toBe(".claudedamnit.com");
    expect(cookieDomainForHost("vault.cool")).toBe(".vault.cool");
    expect(cookieDomainForHost("localhost:3000")).toBeUndefined();
  });
});
