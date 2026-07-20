import { afterEach, describe, expect, it } from "vitest";
import { artifactSlugFromUrl, findSourcePromptMeta, isHyperVaultHost } from "@/lib/extract";
import { injectSourcePromptMeta } from "@/lib/pwa";

afterEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.NEXT_PUBLIC_VANITY_DOMAINS;
});

describe("isHyperVaultHost", () => {
  it("accepts portfolio apexes and their subdomains", () => {
    expect(isHyperVaultHost("hypervault.store")).toBe(true);
    expect(isHyperVaultHost("vault.cool")).toBe(true);
    expect(isHyperVaultHost("nova.vault.cool")).toBe(true);
  });

  it("rejects foreign hosts, including lookalikes", () => {
    expect(isHyperVaultHost("example.com")).toBe(false);
    expect(isHyperVaultHost("evilvault.cool")).toBe(false);
    expect(isHyperVaultHost("vault.cool.attacker.io")).toBe(false);
    expect(isHyperVaultHost("")).toBe(false);
    expect(isHyperVaultHost(null)).toBe(false);
  });

  it("accepts the deployment's own host (localhost dev)", () => {
    expect(isHyperVaultHost("localhost")).toBe(true);
  });

  it("still accepts portfolio domains rotated out of the claimable lineup", () => {
    process.env.NEXT_PUBLIC_VANITY_DOMAINS = "vault.cool";
    expect(isHyperVaultHost("hypervault.store")).toBe(true);
  });

  it("accepts env-activated extra domains", () => {
    process.env.NEXT_PUBLIC_VANITY_DOMAINS = "brand-new.domain";
    expect(isHyperVaultHost("you.brand-new.domain")).toBe(true);
  });

  it("normalizes case and ports", () => {
    expect(isHyperVaultHost("Nova.Vault.COOL:443")).toBe(true);
  });
});

describe("artifactSlugFromUrl", () => {
  it("resolves /a/<slug> links, with or without a trailing slash", () => {
    expect(artifactSlugFromUrl(new URL("https://hypervault.store/a/my-game"))).toBe("my-game");
    expect(artifactSlugFromUrl(new URL("https://nova.vault.cool/a/my-game/"))).toBe("my-game");
  });

  it("falls back to the last path segment", () => {
    expect(artifactSlugFromUrl(new URL("https://hypervault.store/my-game"))).toBe("my-game");
  });

  it("decodes percent-encoded slugs", () => {
    expect(artifactSlugFromUrl(new URL("https://hypervault.store/a/my%2Dgame"))).toBe("my-game");
  });

  it("returns null for the site root", () => {
    expect(artifactSlugFromUrl(new URL("https://hypervault.store/"))).toBe(null);
  });
});

describe("findSourcePromptMeta", () => {
  it("round-trips what injectSourcePromptMeta bakes in, entities included", () => {
    const prompt = `Build a "cool" <game> with A&B — quotes & angles`;
    const html = injectSourcePromptMeta("<html><head></head><body>hi</body></html>", prompt);
    expect(findSourcePromptMeta(html)).toBe(prompt);
  });

  it("tolerates reversed attribute order and single quotes", () => {
    expect(
      findSourcePromptMeta(`<meta content="make a todo app" name="hypervault-source-prompt">`)
    ).toBe("make a todo app");
    expect(
      findSourcePromptMeta(`<meta name='hypervault-source-prompt' content='make a todo app'>`)
    ).toBe("make a todo app");
  });

  it("returns null when no tag is present", () => {
    expect(findSourcePromptMeta("<html><body>no meta here</body></html>")).toBe(null);
    expect(findSourcePromptMeta(`<meta name="description" content="something else">`)).toBe(null);
  });
});
