
import type { SupabaseClient } from "@supabase/supabase-js";
import { authType } from "@/lib/smallchat/mcp-auth";

const SERVER_COLUMNS_CORE =
  "id, name, url, enabled, disabled_tools, tools_cache, introspected_at, registry_id, auth_headers_cipher, oauth_grant_cipher, created_at";

const VAULT_REF_COLUMNS = "auth_headers_secret_id, oauth_grant_secret_id";

export const SERVER_COLUMNS = `${SERVER_COLUMNS_CORE}, ${VAULT_REF_COLUMNS}`;

function isMissingVaultColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /auth_headers_secret_id|oauth_grant_secret_id/i.test(error.message ?? "")
  );
}

let vaultColumnsProbe: Promise<boolean> | null = null;

export function resetVaultColumnCache(): void {
  vaultColumnsProbe = null;
}

async function hasVaultColumns(admin: SupabaseClient): Promise<boolean> {
  if (!vaultColumnsProbe) {
    vaultColumnsProbe = (async () => {
      const { error } = await admin.from("mcp_servers").select("auth_headers_secret_id").limit(1);
      return !isMissingVaultColumn(error);
    })();
  }
  return vaultColumnsProbe;
}

export async function withVaultColumns(base: string, admin: SupabaseClient): Promise<string> {
  return (await hasVaultColumns(admin)) ? `${base}, ${VAULT_REF_COLUMNS}` : base;
}

export async function serverColumns(admin: SupabaseClient): Promise<string> {
  return withVaultColumns(SERVER_COLUMNS_CORE, admin);
}

export function publicServer(row: Record<string, unknown>) {
  const {
    auth_headers_cipher,
    oauth_grant_cipher,
    auth_headers_secret_id,
    oauth_grant_secret_id,
    ...rest
  } = row;
  return {
    ...rest,
    has_auth:
      Boolean(auth_headers_cipher) ||
      Boolean(oauth_grant_cipher) ||
      Boolean(auth_headers_secret_id) ||
      Boolean(oauth_grant_secret_id),
    secret_backed: Boolean(auth_headers_secret_id) || Boolean(oauth_grant_secret_id),
    auth_type: authType({
      auth_headers_cipher: auth_headers_cipher as string | null,
      oauth_grant_cipher: oauth_grant_cipher as string | null,
      auth_headers_secret_id: auth_headers_secret_id as string | null,
      oauth_grant_secret_id: oauth_grant_secret_id as string | null,
    }),
  };
}

export function parseHeaders(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([k, v]) => typeof k === "string" && k.trim() && typeof v === "string" && (v as string).trim()
  ) as [string, string][];
  if (entries.length === 0) return null;
  return Object.fromEntries(entries.map(([k, v]) => [k.trim(), v.trim()]));
}
