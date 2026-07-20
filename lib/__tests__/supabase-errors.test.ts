import { describe, expect, it } from "vitest";
import {
  missingChatSettingsColumnHint,
  missingThemeColumnHint,
  missingToolkitsTableHint,
  missingVaultColumnHint,
} from "@/lib/supabase/errors";

describe("missingToolkitsTableHint", () => {
  it("matches PostgREST's missing-table schema-cache error (PGRST205)", () => {
    const hint = missingToolkitsTableHint({
      code: "PGRST205",
      message: "Could not find the table 'public.mcp_servers' in the schema cache",
    });
    expect(hint).toContain("0018_smallchat_toolkits.sql");
  });

  it("matches the toolkits table too", () => {
    expect(
      missingToolkitsTableHint({
        code: "PGRST205",
        message: "Could not find the table 'public.toolkits' in the schema cache",
      })
    ).toContain("0018_smallchat_toolkits.sql");
  });

  it("matches Postgres 42P01 (undefined_table)", () => {
    expect(
      missingToolkitsTableHint({
        code: "42P01",
        message: 'relation "public.mcp_servers" does not exist',
      })
    ).toContain("0018_smallchat_toolkits.sql");
  });

  it("returns null for a null error", () => {
    expect(missingToolkitsTableHint(null)).toBeNull();
  });

  it("ignores unrelated errors, even ones mentioning the schema cache", () => {
    expect(missingToolkitsTableHint({ code: "PGRST205", message: "Could not find the table 'public.foo'" })).toBeNull();
    expect(missingToolkitsTableHint({ code: "23505", message: "duplicate key value" })).toBeNull();
    expect(
      missingToolkitsTableHint({
        code: "42P01",
        message: 'relation "public.profiles" does not exist',
      })
    ).toBeNull();
  });

  it("does not fire on the theme/chat-settings hints' territory", () => {
    expect(
      missingToolkitsTableHint({
        code: "PGRST204",
        message: "Could not find the 'dashboard_theme' column of 'profiles' in the schema cache",
      })
    ).toBeNull();
  });
});

describe("missingVaultColumnHint", () => {
  it("matches Postgres 42703 for the AgentVault reference columns (the OAuth save failure)", () => {
    const hint = missingVaultColumnHint({
      code: "42703",
      message: "column mcp_servers.auth_headers_secret_id does not exist",
    });
    expect(hint).toContain("0023_agent_vault.sql");
  });

  it("matches PostgREST's schema-cache variant (PGRST204)", () => {
    expect(
      missingVaultColumnHint({
        code: "PGRST204",
        message: "Could not find the 'oauth_grant_secret_id' column of 'mcp_servers' in the schema cache",
      })
    ).toContain("0023_agent_vault.sql");
  });

  it("returns null for a null error", () => {
    expect(missingVaultColumnHint(null)).toBeNull();
  });

  it("ignores unrelated missing-column errors", () => {
    expect(
      missingVaultColumnHint({
        code: "42703",
        message: "column mcp_servers.registry_id does not exist",
      })
    ).toBeNull();
    expect(missingVaultColumnHint({ code: "23505", message: "duplicate key value" })).toBeNull();
  });

  it("does not fire when the whole table is missing (that's the toolkits hint's job)", () => {
    expect(
      missingVaultColumnHint({
        code: "PGRST205",
        message: "Could not find the table 'public.mcp_servers' in the schema cache",
      })
    ).toBeNull();
  });
});

describe("existing schema hints stay scoped", () => {
  it("theme hint does not fire on a missing toolkits table", () => {
    expect(
      missingThemeColumnHint({
        code: "PGRST205",
        message: "Could not find the table 'public.mcp_servers' in the schema cache",
      })
    ).toBeNull();
  });

  it("chat-settings hint does not fire on a missing toolkits table", () => {
    expect(
      missingChatSettingsColumnHint({
        code: "PGRST205",
        message: "Could not find the table 'public.mcp_servers' in the schema cache",
      })
    ).toBeNull();
  });
});
