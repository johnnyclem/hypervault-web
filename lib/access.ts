import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, getUser } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/invites";

export type Access = {
  user: User | null;
  approved: boolean;
  isAdmin: boolean;
};

export async function getAccess(): Promise<Access> {
  const user = await getUser();
  if (!user) return { user: null, approved: false, isAdmin: false };

  const isAdmin = isAdminEmail(user.email);
  if (isAdmin) return { user, approved: true, isAdmin };

  const client = createAdminClient() ?? (await createClient());
  if (!client) return { user, approved: false, isAdmin };
  const checkAccess = () =>
    client.from("account_access").select("user_id").eq("user_id", user.id).maybeSingle();
  let res = await checkAccess();
  if (res.error) res = await checkAccess();
  if (res.error) {
    console.error("getAccess: account_access check failed", res.error);
    return { user, approved: false, isAdmin };
  }
  return { user, approved: Boolean(res.data), isAdmin };
}

export async function requireAdmin(): Promise<
  { admin: SupabaseClient; user: User } | { error: string; status: number }
> {
  const user = await getUser();
  if (!user) return { error: "Sign in required.", status: 401 };
  if (!isAdminEmail(user.email)) return { error: "Admin access required.", status: 403 };
  const admin = createAdminClient();
  if (!admin) return { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY.", status: 503 };
  return { admin, user };
}
