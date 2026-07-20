"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InstallHelpButton } from "@/components/install-help";
import { RepairButton } from "@/components/repair-button";
import { VaultGraph } from "@/components/vault-graph";
import { ViewSourceBadge } from "@/components/view-source";
import { iconGlyph, iconGradient, iconInitial } from "@/lib/pwa";

export type VaultArtifact = {
  id: string;
  slug: string;
  title: string;
  type: string;
  is_jsx: boolean;
  is_pwa: boolean;
  tags: string[] | null;
  connect_to: string[] | null;
  source_prompt: string | null;
  visibility?: "public" | "private" | null;
  icon?: string | null;
  created_at: string;
};

export type VaultConnection = {
  id: string;
  a_id: string;
  b_id: string;
  kind: "manual" | "auto";
};

export type VaultMemory = {
  id: string;
  title: string;
  source: string;
  created_at: string;
};

export type VaultMemoryLink = {
  id: string;
  a_id: string;
  b_id: string;
  kind: "manual" | "auto";
};

export type VaultMemoryArtifactLink = {
  id: string;
  memory_id: string;
  artifact_id: string;
  kind: "manual" | "auto";
};

export function VaultView({
  artifacts,
  connections,
  memories = [],
  memoryLinks = [],
  memoryArtifactLinks = [],
  realms = [],
  autoRepairSlug = null,
  autoRepairError = null,
}: {
  artifacts: VaultArtifact[];
  connections: VaultConnection[];
  memories?: VaultMemory[];
  memoryLinks?: VaultMemoryLink[];
  memoryArtifactLinks?: VaultMemoryArtifactLink[];
  realms?: string[];
  autoRepairSlug?: string | null;
  autoRepairError?: string | null;
}) {
  const [view, setView] = useState<"list" | "graph">("list");

  const connectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of connections) {
      counts.set(c.a_id, (counts.get(c.a_id) ?? 0) + 1);
      counts.set(c.b_id, (counts.get(c.b_id) ?? 0) + 1);
    }
    return counts;
  }, [connections]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-xl border border-border bg-card p-1">
          {(["list", "graph"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={
                view === v
                  ? "rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground"
                  : "rounded-lg px-4 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
              }
            >
              {v === "list" ? "List" : "Graph"}
            </button>
          ))}
        </div>
        <Link href="/vault/new">
          <Button>＋ New from chat</Button>
        </Link>
      </div>

      {view === "graph" ? (
        <VaultGraph
          artifacts={artifacts}
          connections={connections}
          memories={memories}
          memoryLinks={memoryLinks}
          memoryArtifactLinks={memoryArtifactLinks}
        />
      ) : artifacts.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-3">
          {artifacts.map((a) => (
            <li key={a.id}>
              <ArtifactCard
                artifact={a}
                others={artifacts.filter((o) => o.id !== a.id)}
                memories={memories}
                connectionCount={connectionCounts.get(a.id) ?? 0}
                realms={realms}
                autoRepair={autoRepairSlug === a.slug}
                autoRepairError={autoRepairSlug === a.slug ? autoRepairError : null}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ArtifactCard({
  artifact: a,
  others,
  memories,
  connectionCount,
  realms,
  autoRepair = false,
  autoRepairError = null,
}: {
  artifact: VaultArtifact;
  others: VaultArtifact[];
  memories: VaultMemory[];
  connectionCount: number;
  realms: string[];
  autoRepair?: boolean;
  autoRepairError?: string | null;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate font-semibold">{a.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <ViewSourceBadge slug={a.slug} title={a.title} type={a.type} />
              {a.is_jsx && <Badge variant="accent">React · auto-wrapped</Badge>}
              {a.is_pwa && <Badge variant="outline">Installable</Badge>}
              <span>{new Date(a.created_at).toLocaleDateString()}</span>
              {connectionCount > 0 && (
                <span>
                  🔗 {connectionCount} connection{connectionCount === 1 ? "" : "s"}
                </span>
              )}
              {(a.tags ?? []).map((t) => (
                <span key={t} className="font-mono">
                  #{t}
                </span>
              ))}
            </div>
            {a.source_prompt && (
              <details className="mt-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none hover:text-foreground">
                  💬 Source prompt
                </summary>
                <p className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-3 italic">
                  {a.source_prompt}
                </p>
              </details>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <VisibilityToggle artifact={a} />
            <a href={`/a/${a.slug}`} target="_blank" rel="noreferrer">
              <Button variant="secondary" size="sm">
                Open ↗
              </Button>
            </a>
            <CopyLinkButton slug={a.slug} realms={realms} />
            <IconEditor artifact={a} />
            <InstallHelpButton slug={a.slug} title={a.title} isPwa={a.is_pwa} />
            <RepairButton
              slug={a.slug}
              title={a.title}
              autoOpen={autoRepair}
              autoRenderError={autoRepairError}
            />
            <ConnectControl artifact={a} others={others} memories={memories} />
            <DeleteButton artifact={a} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const INVITE_OPTION = "__invite_user__";

function ConnectControl({
  artifact,
  others,
  memories,
}: {
  artifact: VaultArtifact;
  others: VaultArtifact[];
  memories: VaultMemory[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    if (!target || target === INVITE_OPTION) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: artifact.id, target }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not connect.");
        return;
      }
      setOpen(false);
      setTarget("");
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Connect
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <select
        value={target}
        onChange={(e) => (setTarget(e.target.value), setError(null))}
        className="h-8 max-w-[180px] rounded-lg border border-border bg-card px-2 text-xs text-foreground"
        aria-label={`Connect ${artifact.title} to`}
      >
        <option value="">Connect to…</option>
        <optgroup label="Sharing">
          <option value={INVITE_OPTION}>👥 Invite a user…</option>
        </optgroup>
        {others.length > 0 && (
          <optgroup label="Artifacts">
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </optgroup>
        )}
        {memories.length > 0 && (
          <optgroup label="Memories">
            {memories.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {target === INVITE_OPTION ? (
        <InvitePanel artifact={artifact} />
      ) : (
        <Button variant="secondary" size="sm" onClick={connect} disabled={busy || !target}>
          {busy ? "…" : "Link"}
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => (setOpen(false), setTarget(""), setError(null))}>
        ✕
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

type ShareRow = { id: string; email: string | null; display_name: string | null };

function InvitePanel({ artifact }: { artifact: VaultArtifact }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shares, setShares] = useState<ShareRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadShares(() => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.id]);

  async function loadShares(isCancelled: () => boolean = () => false) {
    try {
      const res = await fetch(`/api/shares?artifact=${encodeURIComponent(artifact.id)}`);
      const data = await res.json();
      if (!isCancelled() && Array.isArray(data.shares)) setShares(data.shares);
    } catch {
    }
  }

  async function invite() {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifact: artifact.id, email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not invite them.");
        return;
      }
      setNotice(data.message ?? "Invited!");
      setEmail("");
      await loadShares();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(share: ShareRow) {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/shares", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ share_id: share.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not remove access.");
        return;
      }
      setShares((prev) => prev.filter((s) => s.id !== share.id));
    } catch {
      setError("Network hiccup — try again.");
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && invite()}
        placeholder="their@email.com"
        aria-label={`Invite a user to ${artifact.title} by email`}
        className="h-8 w-[170px] rounded-lg border border-border bg-card px-2 text-xs text-foreground placeholder:text-muted-foreground"
      />
      <Button variant="secondary" size="sm" onClick={invite} disabled={busy || !email.trim()}>
        {busy ? "…" : "Invite"}
      </Button>
      {shares.map((s) => (
        <span
          key={s.id}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs"
        >
          <span className="max-w-[140px] truncate">{s.display_name ?? s.email ?? "someone"}</span>
          <button
            type="button"
            onClick={() => revoke(s)}
            aria-label={`Remove ${s.email ?? "this user"}'s access`}
            className="text-muted-foreground hover:text-destructive"
          >
            ✕
          </button>
        </span>
      ))}
      {notice && <span className="text-xs text-accent">{notice}</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

function IconSwatch({ glyph, gradient, size = 22 }: { glyph: string; gradient: [string, string]; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`,
        color: "white",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * (Array.from(glyph).length >= 2 ? 0.42 : 0.56)),
        fontWeight: 700,
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {glyph}
    </span>
  );
}

function IconEditor({ artifact }: { artifact: VaultArtifact }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(artifact.icon ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gradient = useMemo(() => iconGradient(artifact.slug), [artifact.slug]);
  const glyph = iconGlyph(value.trim() || null, artifact.title);

  async function save(next: string | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/artifacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: artifact.id, icon: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't update the icon.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        title="Set the home-screen icon shown when this app is installed"
        className="gap-1.5"
      >
        <IconSwatch glyph={iconGlyph(artifact.icon, artifact.title)} gradient={gradient} size={18} />
        Icon
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <IconSwatch glyph={glyph} gradient={gradient} size={26} />
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save(value.trim() || null);
          if (e.key === "Escape") {
            setValue(artifact.icon ?? "");
            setOpen(false);
          }
        }}
        maxLength={8}
        placeholder={iconInitial(artifact.title)}
        aria-label={`Home-screen icon glyph for ${artifact.title}`}
        className="h-8 w-16 rounded-md border border-input bg-background px-2 text-center text-sm"
      />
      <Button size="sm" onClick={() => save(value.trim() || null)} disabled={busy}>
        {busy ? "…" : "Save"}
      </Button>
      {(artifact.icon || value) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setValue("");
            save(null);
          }}
          disabled={busy}
          title="Reset to the automatic icon (title initial)"
        >
          Reset
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setValue(artifact.icon ?? "");
          setOpen(false);
        }}
      >
        Cancel
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

function VisibilityToggle({ artifact }: { artifact: VaultArtifact }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPrivate = (artifact.visibility ?? "public") === "private";

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/artifacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: artifact.id, visibility: isPrivate ? "public" : "private" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't change visibility.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={toggle}
        disabled={busy}
        aria-pressed={isPrivate}
        title={
          isPrivate
            ? "Private — only you and invited users can open it. Click to make public."
            : "Public — anyone with the link can open it. Click to make private."
        }
      >
        {busy ? "…" : isPrivate ? "🔒 Private" : "🌐 Public"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

function DeleteButton({ artifact }: { artifact: VaultArtifact }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/artifacts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: artifact.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't delete that right now.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        variant={confirming ? "destructive" : "ghost"}
        size="sm"
        onClick={remove}
        onBlur={() => setConfirming(false)}
        disabled={busy}
        aria-label={confirming ? `Really delete ${artifact.title}?` : `Delete ${artifact.title}`}
      >
        {busy ? "Deleting…" : confirming ? "Really delete?" : "Delete"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

function CopyLinkButton({ slug, realms }: { slug: string; realms: string[] }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function copy(link: string) {
    await navigator.clipboard.writeText(link);
    setOpen(false);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (realms.length < 2) {
    const host = realms[0];
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => copy(host ? `https://${host}/a/${slug}` : `${window.location.origin}/a/${slug}`)}
      >
        {copied ? "Copied!" : "Copy link"}
      </Button>
    );
  }

  return (
    <span className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {copied ? "Copied!" : "Copy link ▾"}
      </Button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            aria-label="Copy link from"
            className="fixed inset-x-4 z-20 mt-1 flex flex-col rounded-xl border border-border bg-card p-1 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:w-max sm:min-w-[220px] sm:max-w-[calc(100vw-3rem)]"
          >
            <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Copy link from…
            </p>
            {realms.map((realm) => (
              <button
                key={realm}
                type="button"
                role="menuitem"
                className="rounded-lg px-3 py-2 text-left font-mono text-xs break-all hover:bg-muted"
                onClick={() => copy(`https://${realm}/a/${slug}`)}
              >
                {realm}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-4xl">🛸</p>
        <p className="font-semibold">Your flight deck is empty</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Paste something your AI made with “New from chat”, or wire up the HyperVault MCP server and let
          your agents save things for you.
        </p>
        <Link href="/vault/new">
          <Button className="mt-2">Save your first artifact</Button>
        </Link>
      </CardContent>
    </Card>
  );
}
