import { describe, expect, it } from "vitest";
import {
  artifactManifest,
  iconGlyph,
  iconGradient,
  iconInitial,
  injectArtifactMeta,
  injectSourcePromptMeta,
  MAX_ICON_GLYPH_CHARS,
  normalizeIconGlyph,
  SOURCE_PROMPT_META_MAX,
  SOURCE_PROMPT_META_NAME,
} from "@/lib/pwa";

const FULL_DOC = `<!DOCTYPE html><html><head><title>x</title></head><body>hi</body></html>`;

describe("injectArtifactMeta", () => {
  it("injects OG tags into <head>", () => {
    const out = injectArtifactMeta(FULL_DOC, { slug: "s", title: "Hello", isPwa: false });
    expect(out).toContain(`property="og:title" content="Hello"`);
    expect(out.indexOf("og:title")).toBeGreaterThan(out.indexOf("<head>"));
    expect(out.indexOf("og:title")).toBeLessThan(out.indexOf("</head>"));
  });

  it("adds PWA tags only when opted in", () => {
    const noPwa = injectArtifactMeta(FULL_DOC, { slug: "s", title: "t", isPwa: false });
    expect(noPwa).not.toContain("manifest");
    const pwa = injectArtifactMeta(FULL_DOC, { slug: "s", title: "t", isPwa: true });
    expect(pwa).toContain(`rel="manifest" href="/api/manifest/s"`);
  });

  it("points the apple-touch-icon at the artifact's own generated icon, not the shared mark", () => {
    const out = injectArtifactMeta(FULL_DOC, { slug: "pomodoro", title: "Pomodoro Timer", isPwa: true });
    expect(out).toMatch(/rel="apple-touch-icon" href="[^"]*\/a\/pomodoro\/icon\?size=180"/);
    expect(out).not.toMatch(/apple-touch-icon"[^>]*icon-192\.png/);
  });

  it("leaves an artifact's own apple-touch-icon untouched", () => {
    const doc = `<html><head><link rel="apple-touch-icon" href="/mine.png" /></head><body></body></html>`;
    const out = injectArtifactMeta(doc, { slug: "s", title: "t", isPwa: true });
    expect(out.match(/rel="apple-touch-icon"/g)?.length).toBe(1);
    expect(out).toContain(`href="/mine.png"`);
  });

  it("injects a favicon link pointing at the artifact's generated icon", () => {
    const out = injectArtifactMeta(FULL_DOC, { slug: "s", title: "t", isPwa: false });
    expect(out).toMatch(/<link rel="icon" href="[^"]*\/a\/s\/icon\?size=192" \/>/);
  });

  it("respects an existing icon link", () => {
    const doc = `<html><head><link rel="icon" href="/mine.png" /></head><body></body></html>`;
    const out = injectArtifactMeta(doc, { slug: "s", title: "t", isPwa: false });
    expect(out.match(/rel="icon"/g)?.length).toBe(1);
  });

  it("respects an existing og:title", () => {
    const doc = `<html><head><meta property="og:title" content="mine" /></head><body></body></html>`;
    const out = injectArtifactMeta(doc, { slug: "s", title: "other", isPwa: false });
    expect(out).not.toContain(`content="other"`);
  });

  it("injects the source-prompt meta tag as a fallback, escaped", () => {
    const out = injectArtifactMeta(FULL_DOC, {
      slug: "s",
      title: "t",
      isPwa: false,
      sourcePrompt: `Make me a <"cool"> dashboard`,
    });
    expect(out).toContain(
      `<meta name="${SOURCE_PROMPT_META_NAME}" content="Make me a &lt;&quot;cool&quot;&gt; dashboard" />`
    );
  });

  it("omits the source-prompt tag when absent or blank", () => {
    expect(injectArtifactMeta(FULL_DOC, { slug: "s", title: "t", isPwa: false })).not.toContain("source-prompt");
    expect(
      injectArtifactMeta(FULL_DOC, { slug: "s", title: "t", isPwa: false, sourcePrompt: "   " })
    ).not.toContain("source-prompt");
  });

  it("truncates very long source prompts in the meta tag", () => {
    const out = injectArtifactMeta(FULL_DOC, {
      slug: "s",
      title: "t",
      isPwa: false,
      sourcePrompt: "x".repeat(SOURCE_PROMPT_META_MAX + 500),
    });
    const match = out.match(/hypervault-source-prompt" content="(x+)"/);
    expect(match?.[1].length).toBe(SOURCE_PROMPT_META_MAX);
  });

  it("does not duplicate a source-prompt tag already baked in at save time", () => {
    const doc = injectSourcePromptMeta(FULL_DOC, "original");
    const out = injectArtifactMeta(doc, { slug: "s", title: "t", isPwa: false, sourcePrompt: "original" });
    expect(out.match(/hypervault-source-prompt/g)?.length).toBe(1);
  });

  it("wraps fragments without <html> in a head block", () => {
    const out = injectArtifactMeta(`<div>hi</div>`, { slug: "s", title: "t", isPwa: false });
    expect(out.startsWith("<head>")).toBe(true);
    expect(out).toContain("<div>hi</div>");
  });
});

describe("iconInitial", () => {
  it("takes the first letter or digit, uppercased", () => {
    expect(iconInitial("Pomodoro Timer")).toBe("P");
    expect(iconInitial("42 Dashboard")).toBe("4");
    expect(iconInitial("  spaced out")).toBe("S");
  });

  it("falls back to # when there is nothing alphanumeric", () => {
    expect(iconInitial("")).toBe("#");
    expect(iconInitial("★ ✦ ✧")).toBe("#");
  });
});

describe("normalizeIconGlyph", () => {
  it("trims and keeps at most the glyph cap in code points", () => {
    expect(normalizeIconGlyph("  P  ")).toBe("P");
    expect(normalizeIconGlyph("Pomodoro")).toBe("Po".slice(0, MAX_ICON_GLYPH_CHARS));
    expect(Array.from(normalizeIconGlyph("Pomodoro") ?? "").length).toBe(MAX_ICON_GLYPH_CHARS);
  });

  it("keeps an emoji whole (no split surrogate pair)", () => {
    expect(normalizeIconGlyph("🍅")).toBe("🍅");
  });

  it("returns null for blank or non-string input, clearing the override", () => {
    expect(normalizeIconGlyph("")).toBeNull();
    expect(normalizeIconGlyph("   ")).toBeNull();
    expect(normalizeIconGlyph(null)).toBeNull();
    expect(normalizeIconGlyph(42)).toBeNull();
  });
});

describe("iconGlyph", () => {
  it("prefers a custom glyph over the title initial", () => {
    expect(iconGlyph("★", "Pomodoro Timer")).toBe("★");
  });

  it("falls back to the title initial when no custom glyph is set", () => {
    expect(iconGlyph(null, "Pomodoro Timer")).toBe("P");
    expect(iconGlyph("  ", "Pomodoro Timer")).toBe("P");
  });
});

describe("iconGradient", () => {
  it("is deterministic for a given slug", () => {
    expect(iconGradient("pomodoro")).toEqual(iconGradient("pomodoro"));
  });

  it("differs between slugs so each app looks distinct", () => {
    expect(iconGradient("pomodoro")).not.toEqual(iconGradient("hypervault"));
  });
});

describe("artifactManifest", () => {
  it("points its icons at the per-artifact generator, not the shared mark", () => {
    const manifest = artifactManifest({ slug: "pomodoro", title: "Pomodoro Timer" });
    expect(manifest.icons.map((i) => i.src)).toEqual([
      expect.stringContaining("/a/pomodoro/icon?size=192"),
      expect.stringContaining("/a/pomodoro/icon?size=512"),
    ]);
    expect(JSON.stringify(manifest)).not.toContain("/icons/icon-192.png");
  });
});

describe("injectSourcePromptMeta", () => {
  it("bakes the escaped prompt into <head>", () => {
    const out = injectSourcePromptMeta(FULL_DOC, `Build a <"neat"> game & make it fun`);
    expect(out).toContain(
      `<meta name="${SOURCE_PROMPT_META_NAME}" content="Build a &lt;&quot;neat&quot;&gt; game &amp; make it fun" />`
    );
    expect(out.indexOf(SOURCE_PROMPT_META_NAME)).toBeLessThan(out.indexOf("</head>"));
  });

  it("adds a head wrapper to fragments", () => {
    const out = injectSourcePromptMeta(`<div>hi</div>`, "prompt");
    expect(out.startsWith("<head>")).toBe(true);
    expect(out).toContain(SOURCE_PROMPT_META_NAME);
  });
});
