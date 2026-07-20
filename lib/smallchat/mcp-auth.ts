
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "@/lib/backends/crypto";
import { loadSecretCipher, writeSecretCipher } from "@/lib/secrets/provider";
import { grantNeedsRefresh, refreshAccessToken, type OAuthGrant } from "@/lib/smallchat/oauth";

export function decryptHeaders(cipher: string | null): Record<string, string> {
  if (!cipher) return {};
  const plain = decryptSecret(cipher);
  if (!plain) return {};
  try {
    const parsed = JSON.parse(plain) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => typeof v === "string")
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

export function encryptGrant(grant: OAuthGrant): string | null {
  return encryptSecret(JSON.stringify(grant));
}

export function decryptGrant(cipher: string | null): OAuthGrant | null {
  if (!cipher) return null;
  const plain = decryptSecret(cipher);
  if (!plain) return null;
  try {
    const parsed = JSON.parse(plain) as OAuthGrant;
    if (typeof parsed.accessToken === "string" && typeof parsed.tokenEndpoint === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

export type ServerAuthSource = {
  id?: string;
  user_id?: string;
  auth_headers_cipher: string | null;
  oauth_grant_cipher: string | null;
  auth_headers_secret_id?: string | null;
  oauth_grant_secret_id?: string | null;
};

export async function resolveServerAuth(
  source: ServerAuthSource,
  admin?: SupabaseClient | null
): Promise<Record<string, string>> {
  let headersCipher = source.auth_headers_cipher;
  let grantCipher = source.oauth_grant_cipher;

  if (admin && source.user_id) {
    if (source.auth_headers_secret_id) {
      const c = await loadSecretCipher(admin, source.user_id, source.auth_headers_secret_id);
      if (c) headersCipher = c;
    }
    if (source.oauth_grant_secret_id) {
      const c = await loadSecretCipher(admin, source.user_id, source.oauth_grant_secret_id);
      if (c) grantCipher = c;
    }
  }

  const headers = decryptHeaders(headersCipher);
  const grant = decryptGrant(grantCipher);
  if (!grant) return headers;

  let active = grant;
  if (grantNeedsRefresh(grant) && grant.refreshToken) {
    try {
      const refreshed = await refreshAccessToken({
        tokenEndpoint: grant.tokenEndpoint,
        clientId: grant.clientId,
        clientSecret: grant.clientSecret,
        refreshToken: grant.refreshToken,
        resource: grant.resource,
        scope: grant.scope,
      });
      active = {
        ...grant,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? grant.refreshToken,
        expiresAt: refreshed.expiresAt,
        scope: refreshed.scope ?? grant.scope,
        tokenType: refreshed.tokenType,
      };
      if (admin) {
        const cipher = encryptGrant(active);
        if (cipher) {
          if (source.oauth_grant_secret_id) {
            await writeSecretCipher(admin, source.oauth_grant_secret_id, cipher);
          } else if (source.id) {
            await admin
              .from("mcp_servers")
              .update({ oauth_grant_cipher: cipher, updated_at: new Date().toISOString() })
              .eq("id", source.id);
          }
        }
      }
    } catch {
    }
  }

  return { ...headers, Authorization: `${active.tokenType || "Bearer"} ${active.accessToken}` };
}

export function authType(source: {
  auth_headers_cipher?: string | null;
  oauth_grant_cipher?: string | null;
  auth_headers_secret_id?: string | null;
  oauth_grant_secret_id?: string | null;
}): "oauth" | "headers" | "none" {
  if (source.oauth_grant_cipher || source.oauth_grant_secret_id) return "oauth";
  if (source.auth_headers_cipher || source.auth_headers_secret_id) return "headers";
  return "none";
}
