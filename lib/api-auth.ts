import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, getUser } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/invites";
import { rateLimit } from "@/lib/ratelimit";

export const API_KEY_HEADER = "X-HyperVault-Key";
const KEY_PREFIX = "hv_";

const DEFAULT_KEY_RATE_LIMIT = 60;

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function extractApiKey(req: NextRequest): string | null {
  const direct = req.headers.get(API_KEY_HEADER);
  if (direct) return direct.trim();
  const m = req.headers.get("authorization")?.match(/^Bearer\s+(hv_[A-Za-z0-9_-]+)\s*$/i);
  return m ? m[1] : null;
}

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { raw, hash: hashKey(raw), prefix: raw.slice(0, 11) };
}

export type ApiIdentity = {
  userId: string;
  via: "session" | "api-key" | "bearer";
  email?: string | null;
  keyId?: string;
};

export function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function passesInviteGate(
  db: SupabaseClientLike,
  userId: string,
  email: string | null | undefined
): Promise<boolean> {
  if (isAdminEmail(email ?? undefined)) return true;
  const { data: access } = await db
    .from("account_access")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(access);
}

type SupabaseClientLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: unknown }> };
    };
  };
};

export async function resolveApiIdentity(
  req: NextRequest,
  opts: { keyRateLimit?: number } = {}
): Promise<{ identity: ApiIdentity } | { error: string; status: number }> {
  const apiKey = extractApiKey(req);

  if (apiKey) {
    const perKeyLimit = opts.keyRateLimit ?? DEFAULT_KEY_RATE_LIMIT;
    const limited = rateLimit(`key:${hashKey(apiKey).slice(0, 16)}`, perKeyLimit, 60_000);
    if (!limited.ok) return { error: `Rate limit exceeded — max ${perKeyLimit} requests/minute per key.`, status: 429 };

    const admin = createAdminClient();
    if (!admin) return { error: "Server is not configured with Supabase credentials.", status: 503 };

    const { data: keyRow, error } = await admin
      .from("api_keys")
      .select("id, user_id, revoked")
      .eq("key_hash", hashKey(apiKey))
      .maybeSingle();

    if (error) return { error: "Could not verify the API key.", status: 500 };
    if (!keyRow || keyRow.revoked) return { error: "Invalid or revoked HyperVault API key.", status: 401 };

    void admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRow.id);

    return { identity: { userId: keyRow.user_id, via: "api-key", keyId: keyRow.id } };
  }

  const token = bearerToken(req);
  if (token) {
    const admin = createAdminClient();
    if (!admin) return { error: "Server is not configured with Supabase credentials.", status: 503 };

    const {
      data: { user },
      error,
    } = await admin.auth.getUser(token);
    if (error || !user) {
      return { error: "Invalid or expired access token — sign in again.", status: 401 };
    }

    const limited = rateLimit(`user:${user.id}`, 120, 60_000);
    if (!limited.ok) return { error: "Rate limit exceeded — slow down a little.", status: 429 };

    if (!(await passesInviteGate(admin as unknown as SupabaseClientLike, user.id, user.email))) {
      return { error: "Your account is on the waitlist — redeem an invite code to unlock the API.", status: 403 };
    }
    return { identity: { userId: user.id, via: "bearer", email: user.email ?? null } };
  }

  const user = await getUser();
  if (!user) {
    return {
      error: `Sign in, pass an ${API_KEY_HEADER} header, or send an Authorization: Bearer access token (create keys in your vault dashboard).`,
      status: 401,
    };
  }
  const limited = rateLimit(`user:${user.id}`, 120, 60_000);
  if (!limited.ok) return { error: "Rate limit exceeded — slow down a little.", status: 429 };

  if (!isAdminEmail(user.email)) {
    const supabase = await createClient();
    if (!(await passesInviteGate(supabase! as unknown as SupabaseClientLike, user.id, user.email))) {
      return { error: "Your account is on the waitlist — redeem an invite code to unlock the API.", status: 403 };
    }
  }
  return { identity: { userId: user.id, via: "session", email: user.email ?? null } };
}
