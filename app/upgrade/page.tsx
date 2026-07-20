import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DomainPicker } from "@/components/domain-picker";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { getUser } from "@/lib/supabase/server";

export const metadata = {
  title: "Upgrade",
  description: "Go Pro and claim your own legendary address like you.vault.cool.",
};

const FREE_FEATURES = [
  "Unlimited saves from chat & MCP",
  "Permanent /a/ links with social previews",
  "Auto-detected React/JSX rendering",
  "PWA install for every artifact",
];

const PRO_FEATURES = [
  "Everything in Free",
  "Up to 10 legendary addresses (you.vault.cool)",
  "Your full vault lives on every subdomain",
  "Custom vault landing page on your domain",
  "Priority rendering & higher rate limits",
  "Early access to graph view & collections",
];

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string }>;
}) {
  const [user, { name }] = await Promise.all([getUser(), searchParams]);

  return (
    <div className="hv-glow min-h-dvh">
      <SiteHeader user={user} />

      <main className="mx-auto w-full max-w-5xl px-6 pb-24">
        <section className="pt-12 text-center sm:pt-20">
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">Claim your corner of the internet</h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Free gets you a permanent vault. Pro gets you a <em>legendary address</em> — a domain so cool
            people ask where you got it.
          </p>
        </section>

        <section className="mt-12 grid gap-6 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Free</CardTitle>
              <CardDescription>
                <span className="text-2xl font-bold text-foreground">$0</span> / forever
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-sm">
                {FREE_FEATURES.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="text-muted-foreground">✓</span> {f}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="border-primary/60 shadow-[0_0_40px_-12px_rgba(139,92,246,0.5)]">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Pro</CardTitle>
                <Badge>Most legendary</Badge>
              </div>
              <CardDescription>
                <span className="text-2xl font-bold text-foreground">$8</span> / month
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-sm">
                {PRO_FEATURES.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="text-primary">✓</span>
                    <span className={f.includes("legendary") ? "font-semibold text-primary" : undefined}>{f}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="mt-16">
          <h2 className="text-xl font-bold">Pick your realm</h2>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">
            Choose a base domain from the HyperVault portfolio, pick a name, and it&apos;s live immediately.
          </p>
          <DomainPicker signedIn={Boolean(user)} initialName={name ?? ""} />
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
