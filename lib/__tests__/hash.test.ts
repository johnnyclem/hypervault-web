import { describe, expect, it } from "vitest";
import { contentHash } from "@/lib/hash";

describe("contentHash", () => {
  it("matches the standard SHA-256 hex digest", () => {
    expect(contentHash("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(contentHash("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("is content-sensitive and encodes non-ASCII as UTF-8", () => {
    expect(contentHash("<h1>Hi</h1>")).not.toBe(contentHash("<h1>Hi!</h1>"));
    expect(contentHash("é")).toBe("4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c");
  });
});
