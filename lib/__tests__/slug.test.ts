import { describe, expect, it } from "vitest";
import { makeSlug } from "@/lib/slug";

describe("makeSlug", () => {
  it("slugifies the title and appends a random suffix", () => {
    expect(makeSlug("My Cool App!")).toMatch(/^my-cool-app-[a-z0-9]{6}$/);
  });

  it("handles titles that reduce to nothing", () => {
    expect(makeSlug("!!!")).toMatch(/^[a-z0-9]{6}$/);
  });

  it("caps the base at 40 characters", () => {
    const slug = makeSlug("x".repeat(100));
    expect(slug.length).toBeLessThanOrEqual(40 + 1 + 6);
  });

  it("produces unique slugs for identical titles", () => {
    expect(makeSlug("same")).not.toEqual(makeSlug("same"));
  });
});
