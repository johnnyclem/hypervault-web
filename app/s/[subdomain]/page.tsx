import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { baseDomainForHost } from "@/lib/domains";
import { themeById, themeForDomain, type DomainTheme } from "@/lib/themes";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { isMissingColumnError, isPrivateArtifact } from "@/lib/visibility";
import { appUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ subdomain: string }> };

async function baseFromHost(): Promise<string> {
  return baseDomainForHost((await headers()).get("host")) ?? "vault.cool";
}

export async function generateMetadata({ params }: Props) {
  const { subdomain } = await params;
  const base = await baseFromHost();
  return {
    title: `${subdomain}.${base}`,
    description: `${subdomain}'s vault on HyperVault — everything their AI creates, in one cool place.`,
  };
}

export default async function SubdomainVaultPage({ params }: Props) {
  const { subdomain } = await params;
  const name = subdomain.toLowerCase();
  const base = await baseFromHost();
  const admin = createAdminClient();

  const [viewer, resolved] = await Promise.all([
    getUser(),
    admin ? resolveOwner(admin, name, base) : null,
  ]);
  const theme = themeById(resolved?.theme) ?? themeForDomain(base);

  if (!resolved) return <AvailablePage name={name} base={base} theme={theme} />;
  const { profile } = resolved;

  type RealmArtifact = { slug: string; title: string; type: string; is_jsx: boolean; visibility?: string | null; created_at: string };
  const isOwner = Boolean(viewer && viewer.id === profile.id);
  const list = (columns: string, publicOnly: boolean) => {
    let query = admin!.from("artifacts").select(columns).eq("user_id", profile.id);
    if (publicOnly) query = query.eq("visibility", "public");
    return query.order("created_at", { ascending: false }).limit(100);
  };

  let res = await list("slug, title, type, is_jsx, visibility, created_at", !isOwner);
  if (res.error && isMissingColumnError(res.error, "visibility")) {
    res = await list("slug, title, type, is_jsx, created_at", false);
  }
  const artifacts = (res.data ?? []) as unknown as RealmArtifact[];

  return (
    <div className={`${theme.className} lp min-h-dvh`}>
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <header className="text-center">
          <h1 className="lp-display font-mono text-3xl font-bold sm:text-4xl">
            {name}
            <span className="text-accent">.{base}</span>
          </h1>
          <p className="mt-3 text-muted-foreground">
            {profile.display_name ?? name}&apos;s flight deck — powered by HyperVault
          </p>
        </header>

        <section className="mt-12 flex flex-col gap-3">
          {(artifacts ?? []).length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">Nothing on deck yet. Check back soon!</p>
          ) : (
            (artifacts ?? []).map((a) => (
              <a key={a.slug} href={`/a/${a.slug}`}>
                <Card className="lp-card transition-colors hover:border-primary/50">
                  <CardContent className="flex items-center justify-between gap-2 p-4">
                    <span className="truncate font-semibold">{a.title}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {isPrivateArtifact(a) && <Badge variant="outline">🔒 private</Badge>}
                      <Badge variant="secondary">{a.is_jsx ? "react" : a.type}</Badge>
                    </span>
                  </CardContent>
                </Card>
              </a>
            ))
          )}
        </section>

        <footer className="mt-16 text-center text-xs text-muted-foreground">
          Want your own? <a href={`${appUrl()}/upgrade`} className="text-accent underline underline-offset-4">Claim a .cool address →</a>
        </footer>
      </main>
    </div>
  );
}

async function resolveOwner(admin: SupabaseClient, name: string, base: string) {
  const { data: claim } = await admin
    .from("domain_claims")
    .select("user_id, theme")
    .eq("subdomain", name)
    .eq("base_domain", base)
    .maybeSingle();

  const query = admin.from("profiles").select("id, display_name");
  const { data: profile } = claim
    ? await query.eq("id", claim.user_id).maybeSingle()
    : await query.eq("vanity_subdomain", name).maybeSingle();
  return profile ? { profile, theme: claim?.theme ?? null } : null;
}

function AvailablePage({ name, base, theme }: { name: string; base: string; theme: DomainTheme }) {
  return (
    <div className={`${theme.className} lp flex min-h-dvh items-center justify-center px-6`}>
      <div className="max-w-md text-center">
        <p className="text-5xl">✨</p>
        <h1 className="lp-display mt-6 font-mono text-3xl font-bold">
          {name}
          <span className="text-accent">.{base}</span>
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          is still available. It could be yours in about 12 seconds.
        </p>
        <a href={`${appUrl()}/upgrade?name=${encodeURIComponent(name)}`} className="mt-8 inline-block">
          <Button size="lg" variant="accent" className="lp-btn">
            Claim {name}.{base}
          </Button>
        </a>
        <p className="mt-6 text-xs text-muted-foreground">
          Part of <a href={appUrl()} className="underline underline-offset-4">HyperVault</a> — your personal
          flight deck for everything your AI creates.
        </p>
      </div>
    </div>
  );
}
