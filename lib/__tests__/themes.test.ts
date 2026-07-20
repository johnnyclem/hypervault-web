import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOMAIN_PORTFOLIO } from "@/lib/domains";
import { DEFAULT_THEME, DOMAIN_THEMES, isThemeId, THEMES, themeById, themeForDomain } from "@/lib/themes";

describe("THEMES registry", () => {
  it("covers the full designprompts.dev catalog", () => {
    const ids = THEMES.map((t) => t.styleId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(
      [
        "academia", "art-deco", "aurora-mesh", "bauhaus", "bold-typography",
        "botanical", "claymorphism", "cyberpunk", "enterprise", "flat-design",
        "glassmorphism", "hyperstudio", "industrial", "kinetic", "luxury", "material-design",
        "maximalism", "minimal-dark", "modern-dark", "monochrome",
        "neo-brutalism", "neumorphism", "newsprint", "organic",
        "playful-geometric", "professional", "retro", "saas", "sketch",
        "swiss-minimalist", "terminal", "vaporwave", "web3", "gsap",
      ].sort()
    );
  });

  it("gives every style its own theme-* wrapper class", () => {
    const classNames = THEMES.map((t) => t.className);
    expect(new Set(classNames).size).toBe(classNames.length);
    for (const className of classNames) {
      expect(className).toMatch(/^theme-[a-z0-9-]+$/);
    }
  });

  it("has a CSS variable block in globals.css for every wrapper class", () => {
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    for (const theme of THEMES) {
      expect(css, `missing .${theme.className} block in app/globals.css`).toContain(`.${theme.className} {`);
    }
  });

  it("looks styles up by id and rejects unknown ids", () => {
    expect(themeById("gsap")).toBe(DEFAULT_THEME);
    expect(themeById("cyberpunk")?.className).toBe("theme-cyber");
    expect(themeById("not-a-style")).toBeUndefined();
    expect(themeById(null)).toBeUndefined();
    expect(themeById(undefined)).toBeUndefined();
    expect(isThemeId("web3")).toBe(true);
    expect(isThemeId("not-a-style")).toBe(false);
    expect(isThemeId(42)).toBe(false);
  });
});

describe("themeForDomain", () => {
  it("gives every portfolio domain a theme", () => {
    for (const { domain } of DOMAIN_PORTFOLIO) {
      expect(DOMAIN_THEMES[domain], `missing theme for ${domain}`).toBeDefined();
    }
  });

  it("gives each themed domain its own wrapper class (hypervault.store shares the brand look)", () => {
    const classNames = Object.entries(DOMAIN_THEMES)
      .filter(([domain]) => domain !== "hypervault.store")
      .map(([, theme]) => theme.className);
    expect(new Set(classNames).size).toBe(classNames.length);
  });

  it("only maps domains to styles from the registry", () => {
    for (const theme of Object.values(DOMAIN_THEMES)) {
      expect(themeById(theme.styleId)).toBe(theme);
    }
  });

  it("is case-insensitive and falls back to the HyperVault brand theme", () => {
    expect(themeForDomain("VAULT.COOL")).toBe(DOMAIN_THEMES["vault.cool"]);
    expect(themeForDomain("unknown.example")).toBe(DEFAULT_THEME);
    expect(themeForDomain(null)).toBe(DEFAULT_THEME);
    expect(themeForDomain(undefined)).toBe(DEFAULT_THEME);
  });

  it("keeps every wrapper class on the theme-* naming convention", () => {
    for (const theme of Object.values(DOMAIN_THEMES)) {
      expect(theme.className).toMatch(/^theme-[a-z0-9-]+$/);
    }
  });
});
