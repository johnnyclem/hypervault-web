"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Brain,
  FlaskConical,
  LogIn,
  Menu,
  MessageSquare,
  Moon,
  Palette,
  ShieldCheck,
  Sparkles,
  Vault,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { DashboardThemeRow, ThemeSwitcher, type RealmThemeRow } from "@/components/theme-switcher";
import { MAX_PRO_SUBDOMAINS } from "@/lib/domains";

const ITEM_CLASS =
  "flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm font-medium transition-colors hover:bg-muted";
const ICON_CLASS =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary";
const HEADING_CLASS = "px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

function NavItem({
  href,
  icon,
  label,
  hint,
  onNavigate,
  trailing,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  hint: string;
  onNavigate: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <Link href={href} onClick={onNavigate} className={ITEM_CLASS}>
      <span className={ICON_CLASS}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{label}</span>
        <span className="text-xs font-normal text-muted-foreground">{hint}</span>
      </span>
      {trailing}
    </Link>
  );
}

export function MobileNav({
  signedIn,
  isAdmin,
  realms = [],
  dashboardTheme = null,
  plan = "free",
  pendingDreams = 0,
}: {
  signedIn: boolean;
  isAdmin: boolean;
  realms?: RealmThemeRow[];
  dashboardTheme?: string | null;
  plan?: string;
  pendingDreams?: number;
}) {
  const [open, setOpen] = useState(false);
  const [themesOpen, setThemesOpen] = useState(false);
  const close = () => setOpen(false);

  const realmHosts = realms.map((r) => `${r.subdomain}.${r.base_domain}`);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted"
      >
        <Menu className="h-5 w-5" />
      </button>
      <Drawer open={open} onClose={close} side="right" title="Menu">
        <nav className="flex flex-col gap-2">
          {signedIn && (
            <>
              <NavItem
                href="/chat"
                icon={<MessageSquare className="h-4 w-4" />}
                label="Chat"
                hint="Talk to any connected backend"
                onNavigate={close}
              />
              <NavItem
                href="/vault/memory"
                icon={<Brain className="h-4 w-4" />}
                label="Memories"
                hint="Wiki, recall, digest & history"
                onNavigate={close}
              />
              <button
                type="button"
                onClick={() => {
                  close();
                  setThemesOpen(true);
                }}
                className={`${ITEM_CLASS} w-full text-left`}
              >
                <span className={ICON_CLASS}>
                  <Palette className="h-4 w-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>Themes</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    Dress your dashboard and realms
                  </span>
                </span>
              </button>
            </>
          )}

          {isAdmin && (
            <NavItem
              href="/admin"
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Admin"
              hint="Invites, waitlist, and accounts"
              onNavigate={close}
            />
          )}

          {!signedIn && (
            <NavItem
              href="/upgrade"
              icon={<Sparkles className="h-4 w-4" />}
              label="Pricing"
              hint="Plans and upgrades"
              onNavigate={close}
            />
          )}
        </nav>

        {signedIn && (
          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
            <p className={HEADING_CLASS}>Vaults</p>
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-3 py-3">
              {plan === "pro" ? <Badge>Pro</Badge> : <Badge variant="secondary">Free</Badge>}
              {realmHosts.map((realm) => (
                <a key={realm} href={`https://${realm}`} className="max-w-full">
                  <Badge variant="accent" className="max-w-full font-mono">
                    <span className="truncate">{realm}</span>
                    <span className="ml-1">↗</span>
                  </Badge>
                </a>
              ))}
              {realmHosts.length === 0 && (
                <span className="text-xs text-muted-foreground">No realms claimed yet</span>
              )}
            </div>
            {realmHosts.length === 0 ? (
              <Link href="/upgrade" onClick={close}>
                <Button variant="outline" size="sm" className="w-full">
                  Claim your realm
                </Button>
              </Link>
            ) : (
              realmHosts.length < MAX_PRO_SUBDOMAINS && (
                <Link href="/upgrade" onClick={close}>
                  <Button variant="outline" size="sm" className="w-full">
                    Claim another ({realmHosts.length}/{MAX_PRO_SUBDOMAINS})
                  </Button>
                </Link>
              )
            )}
          </div>
        )}

        {signedIn && (
          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
            <p className={`${HEADING_CLASS} flex items-center gap-1.5`}>
              <FlaskConical className="h-3.5 w-3.5" />
              Beta
            </p>
            <NavItem
              href="/vault/dreams"
              icon={<Moon className="h-4 w-4" />}
              label="Dreams"
              hint="Connections found while you were away"
              onNavigate={close}
              trailing={
                pendingDreams > 0 ? (
                  <Badge variant="accent" className="shrink-0">
                    {pendingDreams}
                  </Badge>
                ) : undefined
              }
            />
          </div>
        )}

        <div className="mt-4 border-t border-border pt-4">
          {signedIn ? (
            <Link href="/vault" onClick={close}>
              <Button className="w-full gap-2">
                <Vault className="h-4 w-4" />
                Open my vault
              </Button>
            </Link>
          ) : (
            <Link href="/login" onClick={close}>
              <Button className="w-full gap-2">
                <LogIn className="h-4 w-4" />
                Sign in
              </Button>
            </Link>
          )}
        </div>
      </Drawer>

      {signedIn && (
        <Drawer open={themesOpen} onClose={() => setThemesOpen(false)} side="right" title="Realm themes">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Dress your dashboard, chat, and each of your subdomains in any style from{" "}
              <a href="https://designprompts.dev" className="text-accent underline underline-offset-4">
                designprompts.dev
              </a>
              . Realm looks are what visitors see, effective immediately.
            </p>
            <DashboardThemeRow theme={dashboardTheme} />
            {realms.length > 0 ? (
              <ThemeSwitcher realms={realms} />
            ) : (
              <div className="flex flex-col items-start gap-3 border-t border-border pt-4">
                <p className="text-sm text-muted-foreground">
                  Claimed subdomains can each wear their own style too. Claim a realm first, then pick
                  its look here.
                </p>
                <Link href="/upgrade" onClick={() => setThemesOpen(false)}>
                  <Button size="sm">Claim your realm</Button>
                </Link>
              </div>
            )}
          </div>
        </Drawer>
      )}
    </>
  );
}
