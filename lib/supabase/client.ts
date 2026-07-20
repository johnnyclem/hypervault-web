"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookieDomainForHost } from "@/lib/domains";

export function createClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const host = typeof window === "undefined" ? null : window.location.hostname;
  return createBrowserClient(url, key, { cookieOptions: { domain: cookieDomainForHost(host) } });
}
