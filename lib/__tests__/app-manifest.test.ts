import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("app manifest", () => {
  it("scopes the whole origin so installed-PWA nav stays in-app", () => {
    const m = manifest();
    expect(m.scope).toBe("/");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
  });

  it("stays host-agnostic so vanity domains serve the same manifest", () => {
    const json = JSON.stringify(manifest());
    expect(json).not.toContain("http://");
    expect(json).not.toContain("https://");
  });
});
