import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { MobileNav } from "@/components/mobile-nav";
import type { RealmThemeRow } from "@/components/theme-switcher";
import { MAX_PRO_SUBDOMAINS } from "@/lib/domains";
import { getDashboardTheme } from "@/lib/dashboard-theme";
import { createClient } from "@/lib/supabase/server";

export async function SiteHeader({ user, isAdmin = false }: { user: User | null; isAdmin?: boolean }) {
  let realms: RealmThemeRow[] = [];
  let dashboardThemeId: string | null = null;
  let plan = "free";
  let pendingDreams = 0;

  if (user) {
    const supabase = await createClient();
    if (supabase) {
      const [{ data: claims }, { data: profile }, { count }, dashboardTheme] = await Promise.all([
        supabase
          .from("domain_claims")
          .select("subdomain, base_domain, theme")
          .eq("user_id", user.id)
          .order("claimed_at", { ascending: true })
          .limit(MAX_PRO_SUBDOMAINS),
        supabase.from("profiles").select("plan, vanity_subdomain").eq("id", user.id).maybeSingle(),
        supabase
          .from("dream_connections")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("status", "pending"),
        getDashboardTheme(user.id),
      ]);
      realms = (claims ?? []) as RealmThemeRow[];
      if (realms.length === 0 && profile?.vanity_subdomain) {
        realms = [{ subdomain: profile.vanity_subdomain, base_domain: "vault.cool", theme: null }];
      }
      plan = profile?.plan ?? "free";
      pendingDreams = count ?? 0;
      dashboardThemeId = dashboardTheme.themeId;
    }
  }

  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4 md:px-6 md:py-5">
      <Link href="/" className="flex shrink-0 items-center gap-2 font-bold tracking-tight">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary font-mono text-sm text-primary-foreground">
          H
        </span>
        HyperVault
      </Link>

      <nav className="hidden items-center gap-2 md:flex">
        {user && (
          <Link href="/chat">
            <Button variant="ghost" size="sm">
              Chat
            </Button>
          </Link>
        )}
        {isAdmin && (
          <Link href="/admin">
            <Button variant="ghost" size="sm">
              Admin
            </Button>
          </Link>
        )}
        {!user && (
          <Link href="/upgrade">
            <Button variant="ghost" size="sm">
              Pricing
            </Button>
          </Link>
        )}
        {user ? (
          <Link href="/vault">
            <Button size="sm">Open my vault</Button>
          </Link>
        ) : (
          <Link href="/login">
            <Button size="sm">Sign in</Button>
          </Link>
        )}
      </nav>

      <div className="flex items-center gap-1.5 md:hidden">
        {user ? (
          <Link href="/vault">
            <Button size="sm">My vault</Button>
          </Link>
        ) : (
          <Link href="/login">
            <Button size="sm">Sign in</Button>
          </Link>
        )}
      </div>

      <MobileNav
        signedIn={!!user}
        isAdmin={isAdmin}
        realms={realms}
        dashboardTheme={dashboardThemeId}
        plan={plan}
        pendingDreams={pendingDreams}
      />
    </header>
  );
}
