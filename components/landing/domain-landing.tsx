import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { DomainTheme } from "@/lib/themes";

const EXAMPLE_SUBDOMAINS = ["nova", "atlas", "kai", "merlin"];

const EXAMPLE_ADDRESSES = [
  "nova.vault.cool",
  "dreamlab.cleon.city",
  "merlin.onlywizards.website",
  "kai.claudedamnit.com",
];

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Your AI makes something",
    body: "A dashboard, a game, a report, a page — anything worth keeping from a chat or an agent run.",
  },
  {
    step: "2",
    title: "Save it with one command",
    body: "From chat, the API, or the HyperVault MCP server. JSX is auto-detected and made runnable.",
  },
  {
    step: "3",
    title: "It's yours forever",
    body: "A permanent link you can share or install like an app — and any agent can pick it back up and keep working.",
  },
];

const AGENT_VAULT_POINTS = [
  {
    title: "Grants, not autofill",
    body: "You grant one agent access to one named secret. That agent fetches it at runtime; every other agent — and every browser session — is refused.",
  },
  {
    title: "Rotates in place",
    body: "OAuth tokens refresh right where they're stored, so your agents never hold a stale credential and you never re-paste one.",
  },
  {
    title: "Never in the prompt",
    body: "Secrets are encrypted at rest and resolved server-side, so credentials never ride along in a prompt, a config file, or a chat log.",
  },
];

export function DomainLanding({
  domain,
  brand,
  theme,
  user,
}: {
  domain: string;
  brand?: string;
  theme: DomainTheme;
  user: User | null;
}) {
  const addresses = [
    { address: `you.${domain}`, featured: true },
    ...EXAMPLE_ADDRESSES.filter((a) => !a.endsWith(`.${domain}`))
      .slice(0, 3)
      .map((address) => ({ address, featured: false })),
  ];

  return (
    <div className={`${theme.className} lp flex min-h-dvh flex-col`}>
      <header className="lp-header sticky top-0 z-50">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="lp-display flex items-center gap-2 font-bold tracking-tight">
            <span className="lp-logo flex h-7 w-7 items-center justify-center font-mono text-sm">
              H
            </span>
            {brand ?? domain}
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/upgrade">
              <Button variant="ghost" size="sm" className="lp-btn shadow-none">
                Pricing
              </Button>
            </Link>
            {user ? (
              <Link href="/vault">
                <Button size="sm" className="lp-btn">
                  Dashboard
                </Button>
              </Link>
            ) : (
              <Link href="/login">
                <Button size="sm" className="lp-btn">
                  Login
                </Button>
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6">
        <section className="flex flex-col items-center pb-16 pt-20 text-center sm:pt-28">
          <Badge variant="outline" className="lp-chip mb-6 border-primary/40 text-primary">
            For you and your AI agents
          </Badge>
          <h1 className="lp-display lp-hero-title max-w-3xl text-4xl font-bold leading-tight sm:text-6xl">
            A place to store your AI stuff.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            Every chat produces something worth keeping — an app, a page, a report, a prompt.
            Save it with one command and it&apos;s yours forever: a permanent link you can share,
            install like an app, or hand back to any agent to keep working on.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
            {user ? (
              <Link href="/vault">
                <Button size="lg" className="lp-btn">
                  Open my vault
                </Button>
              </Link>
            ) : (
              <Link href="/login">
                <Button size="lg" className="lp-btn">
                  Join the waitlist
                </Button>
              </Link>
            )}
            {!user && (
              <Link
                href="/login?invite=1"
                className="text-sm font-semibold text-accent underline-offset-4 hover:underline"
              >
                Have an invite code? →
              </Link>
            )}
            <Link
              href="/upgrade"
              className="text-sm font-semibold text-accent underline-offset-4 hover:underline"
            >
              See plans →
            </Link>
          </div>
        </section>

        <section className="grid gap-6 pb-24 sm:grid-cols-3">
          {HOW_IT_WORKS.map((item) => (
            <Card key={item.step} className="lp-card">
              <CardContent className="pt-6">
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 font-mono text-sm font-bold text-primary">
                  {item.step}
                </div>
                <h3 className="lp-display font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{item.body}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="pb-24">
          <h2 className="lp-display mx-auto max-w-2xl text-center text-3xl font-bold leading-tight sm:text-4xl">
            The password manager your agents can actually use
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-muted-foreground">
            1Password and Apple Passwords were built for people — autofill, browser extensions, a
            thumbprint. Your agents have API keys and tool calls. AgentVault stores their
            credentials the way agents need them.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {AGENT_VAULT_POINTS.map((item) => (
              <Card key={item.title} className="lp-card">
                <CardContent className="pt-6">
                  <h3 className="lp-display font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{item.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="pb-24">
          <h2 className="lp-display text-center text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            And yes — a legendary address to keep it all at
          </h2>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {addresses.map(({ address, featured }) => (
              <span
                key={address}
                className={
                  featured
                    ? "lp-chip border border-primary/50 bg-primary/10 px-4 py-2 font-mono text-sm text-primary"
                    : "lp-chip border border-border bg-card px-4 py-2 font-mono text-sm text-muted-foreground"
                }
              >
                {address}
              </span>
            ))}
          </div>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {EXAMPLE_SUBDOMAINS[0]}
            <span className="font-mono text-accent">.{domain}</span> could be yours — your whole
            vault, live at an address that&apos;s unmistakably you.
          </p>
        </section>
      </main>

      <footer className="border-t border-border py-10">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-3 px-6 text-sm text-muted-foreground sm:flex-row sm:justify-between">
          <p>
            {domain} is part of HyperVault — a place to store your AI stuff.
          </p>
          <nav className="flex gap-5">
            <Link href="/upgrade" className="hover:text-foreground">
              Pricing
            </Link>
            <Link href="/cool" className="hover:text-foreground">
              vault.cool
            </Link>
            <a href="https://github.com/johnnyclem/hypervault" className="hover:text-foreground">
              GitHub
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
