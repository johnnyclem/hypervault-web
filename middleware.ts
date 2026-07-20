import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isSessionCookieName } from "@/lib/auth-cookies";
import { activeBaseDomains, cookieDomainForHost } from "@/lib/domains";

const VANITY_BASES = activeBaseDomains();

export async function middleware(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase().split(":")[0];
  const { pathname } = request.nextUrl;

  if (pathname === "/" && request.nextUrl.searchParams.has("code")) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    return NextResponse.redirect(url);
  }

  for (const base of VANITY_BASES) {
    if (host === base || host === `www.${base}`) {
      if (pathname === "/") {
        const url = request.nextUrl.clone();
        url.pathname = `/d/${base}`;
        return NextResponse.rewrite(url);
      }
      break;
    }
    if (host.endsWith(`.${base}`)) {
      const sub = host.slice(0, -(base.length + 1));
      if (sub && !sub.includes(".")) {
        if (
          pathname.startsWith("/api/") ||
          pathname.startsWith("/a/") ||
          pathname === "/manifest.webmanifest"
        ) {
          return refreshSession(request);
        }
        return handleVanitySubdomain(request, sub, base);
      }
    }
  }

  return refreshSession(request);
}

async function handleVanitySubdomain(request: NextRequest, sub: string, base: string) {
  const { pathname } = request.nextUrl;
  const rewriteToPublicVault = () => {
    const url = request.nextUrl.clone();
    url.pathname = `/s/${sub}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (pathname !== "/" || !supabaseUrl || !supabaseKey) return rewriteToPublicVault();
  if (!request.cookies.getAll().some((c) => isSessionCookieName(c.name))) return rewriteToPublicVault();

  const refreshed: { name: string; value: string; options: CookieOptions }[] = [];
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookieOptions: { domain: `.${base}` },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        refreshed.push(...cookiesToSet);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let response: NextResponse | null = null;
  if (user) {
    const { data: claim } = await supabase
      .from("domain_claims")
      .select("id")
      .eq("user_id", user.id)
      .eq("subdomain", sub)
      .eq("base_domain", base)
      .maybeSingle();
    if (claim) {
      const dest = request.nextUrl.clone();
      dest.hostname = base;
      dest.pathname = "/vault";
      dest.search = "";
      response = NextResponse.redirect(dest);
    }
  }

  response ??= rewriteToPublicVault();
  refreshed.forEach(({ name, value, options }) => response!.cookies.set(name, value, options));
  return response;
}

async function refreshSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  if (!request.cookies.getAll().some((c) => isSessionCookieName(c.name))) return response;

  const supabase = createServerClient(url, key, {
    cookieOptions: { domain: cookieDomainForHost(request.headers.get("host")) },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|og.png).*)"],
};
