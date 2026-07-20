import { describe, expect, it } from "vitest";
import { isMissingInviteTable, isMissingRedeemFunction } from "@/lib/invite-schema";

describe("isMissingInviteTable", () => {
  it("matches PostgREST's missing-table error for invite_codes", () => {
    expect(
      isMissingInviteTable({
        code: "PGRST205",
        message: "Could not find the table 'public.invite_codes' in the schema cache",
      })
    ).toBe(true);
  });

  it("matches the other 0011 tables too", () => {
    expect(
      isMissingInviteTable({
        code: "PGRST205",
        message: "Could not find the table 'public.account_access' in the schema cache",
      })
    ).toBe(true);
    expect(
      isMissingInviteTable({
        code: "PGRST205",
        message: "Could not find the table 'public.waitlist' in the schema cache",
      })
    ).toBe(true);
  });

  it("matches raw Postgres 42P01", () => {
    expect(
      isMissingInviteTable({
        code: "42P01",
        message: 'relation "public.invite_codes" does not exist',
      })
    ).toBe(true);
  });

  it("ignores unrelated errors, even on the same tables", () => {
    expect(isMissingInviteTable(null)).toBe(false);
    expect(
      isMissingInviteTable({
        code: "23505",
        message: 'duplicate key value violates unique constraint "invite_codes_code_key"',
      })
    ).toBe(false);
    expect(
      isMissingInviteTable({
        code: "PGRST205",
        message: "Could not find the table 'public.llm_backends' in the schema cache",
      })
    ).toBe(false);
  });
});

describe("isMissingRedeemFunction", () => {
  it("matches PostgREST's missing-function error", () => {
    expect(
      isMissingRedeemFunction({
        code: "PGRST202",
        message: "Could not find the function public.redeem_invite_code(p_code) in the schema cache",
      })
    ).toBe(true);
  });

  it("matches raw Postgres 42883", () => {
    expect(
      isMissingRedeemFunction({
        code: "42883",
        message: "function public.redeem_invite_code(text) does not exist",
      })
    ).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isMissingRedeemFunction(null)).toBe(false);
    expect(isMissingRedeemFunction({ code: "PGRST202", message: "Could not find the function public.other_fn" })).toBe(
      false
    );
  });
});
