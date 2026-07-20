import { NextResponse, type NextRequest } from "next/server";
import {
  duplicateCookieNames,
  hasSessionCookie,
  hasVerifierCookie,
  parseCookieNames,
} from "@/lib/auth-cookies";
import { baseDomainForHost, cookieDomainForHost } from "@/lib/domains";
import { getUser, supabaseConfigured } from "@/lib/supabase/server";
import { appUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const host = request.headers.get("host");
  const base = baseDomainForHost(host);
  const cookieHeader = request.headers.get("cookie");
  const names = parseCookieNames(cookieHeader);
  const supabaseNames = [...new Set(names.filter((n) => n.startsWith("sb-")))];
  const duplicates = duplicateCookieNames(cookieHeader).filter((n) => n.startsWith("sb-"));

  const user = await getUser().catch(() => null);

  return NextResponse.json(
    {
      host,
      knownBaseDomain: base,
      cookieDomain: cookieDomainForHost(host) ?? "(host-only)",
      appUrl: appUrl(),
      supabaseConfigured: supabaseConfigured(),
      signedIn: Boolean(user),
      userId: user?.id ?? null,
      cookies: {
        supabaseCookieNames: supabaseNames,
        hasSessionCookie: hasSessionCookie(names),
        hasVerifierCookie: hasVerifierCookie(names),
        duplicateSupabaseCookies: duplicates,
      },
      requiredRedirectUrls: base ? [`https://${base}/**`, `https://*.${base}/**`] : null,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
