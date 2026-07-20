import { describe, expect, it } from "vitest";
import { generateInviteCode, isAdminEmail, normalizeInviteCode } from "@/lib/invites";

describe("generateInviteCode", () => {
  it("mints HV-XXXX-XXXX codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateInviteCode()).toMatch(/^HV-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  it("does not repeat itself in practice", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateInviteCode()));
    expect(codes.size).toBe(200);
  });
});

describe("normalizeInviteCode", () => {
  it("trims and uppercases", () => {
    expect(normalizeInviteCode("  hv-abcd-2345 ")).toBe("HV-ABCD-2345");
  });
});

describe("isAdminEmail", () => {
  it("matches configured admin emails case-insensitively", () => {
    process.env.HYPERVAULT_ADMIN_EMAILS = "admin@example.com";
    expect(isAdminEmail("admin@example.com")).toBe(true);
    expect(isAdminEmail("Admin@Example.com")).toBe(true);
    delete process.env.HYPERVAULT_ADMIN_EMAILS;
  });

  it("rejects everyone else and empty values", () => {
    process.env.HYPERVAULT_ADMIN_EMAILS = "admin@example.com";
    expect(isAdminEmail("someone@example.com")).toBe(false);
    expect(isAdminEmail("")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    delete process.env.HYPERVAULT_ADMIN_EMAILS;
  });

  it("matches no one when unset", () => {
    delete process.env.HYPERVAULT_ADMIN_EMAILS;
    expect(isAdminEmail("someone@example.com")).toBe(false);
  });
});
