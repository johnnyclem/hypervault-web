import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookieDomainForHost } from "@/lib/domains";
import { isSessionCookieName } from "@/lib/auth-cookies";

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function createClient(): Promise<SupabaseClient | null> {
  if (!supabaseConfigured()) return null;
  const cookieStore = await cookies();
  const host = (await headers()).get("host");

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { domain: cookieDomainForHost(host) },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
          }
        },
      },
    }
  );
}

export async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const first = await supabase.auth.getUser().catch(() => null);
  if (first?.data.user) return first.data.user;

  const cookieStore = await cookies();
  const carriesSession = cookieStore.getAll().some((c) => isSessionCookieName(c.name));
  if (!carriesSession) return null;

  const second = await supabase.auth.getUser().catch(() => null);
  return second?.data.user ?? null;
}
