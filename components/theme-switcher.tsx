"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEFAULT_THEME, THEMES, themeById, themeForDomain, type DomainTheme } from "@/lib/themes";
import { cn } from "@/lib/utils";

export type RealmThemeRow = {
  subdomain: string;
  base_domain: string;
  theme: string | null;
};

type SaveState = { kind: "idle" } | { kind: "busy" } | { kind: "saved" } | { kind: "error"; message: string };

const SELECT_CLASSES = cn(
  "ml-auto max-w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm",
  "focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
);

export function DashboardThemeRow({ theme }: { theme: string | null }) {
  const router = useRouter();
  const [current, setCurrent] = useState(theme);
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  async function save(styleId: string | null) {
    const previous = current;
    setCurrent(styleId);
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/dashboard-theme", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: styleId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCurrent(previous);
        setState({ kind: "error", message: data.error ?? "Save failed — try again." });
        return;
      }
      setState({ kind: "saved" });
      router.refresh();
    } catch {
      setCurrent(previous);
      setState({ kind: "error", message: "Network hiccup — give it another shot." });
    }
  }

  const active = themeById(current) ?? DEFAULT_THEME;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ThemeSwatch theme={active} />
      <span className="min-w-0 text-sm font-semibold">Your dashboard &amp; chat</span>
      <select
        aria-label="Theme for your dashboard and chat"
        value={current ?? ""}
        disabled={state.kind === "busy"}
        onChange={(e) => save(e.target.value || null)}
        className={SELECT_CLASSES}
      >
        <option value="">HyperVault default — {DEFAULT_THEME.styleName}</option>
        {THEMES.map((t) => (
          <option key={t.styleId} value={t.styleId}>
            {t.styleName} ({t.mode})
          </option>
        ))}
      </select>
      <span className="w-14 text-xs text-muted-foreground" aria-live="polite">
        {state.kind === "busy" && "Saving…"}
        {state.kind === "saved" && <span className="text-accent">Saved ✓</span>}
      </span>
      {state.kind === "error" && (
        <p className="w-full text-xs text-destructive" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}

export function ThemeSwitcher({ realms }: { realms: RealmThemeRow[] }) {
  const [rows, setRows] = useState(realms);
  const [saving, setSaving] = useState<Record<string, SaveState>>({});

  async function setTheme(row: RealmThemeRow, styleId: string | null) {
    const key = `${row.subdomain}.${row.base_domain}`;
    const previous = rows;
    setRows((rs) => rs.map((r) => (r === row ? { ...r, theme: styleId } : r)));
    setSaving((s) => ({ ...s, [key]: { kind: "busy" } }));
    try {
      const res = await fetch("/api/claim-domain", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subdomain: row.subdomain, base_domain: row.base_domain, theme: styleId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRows(previous);
        setSaving((s) => ({ ...s, [key]: { kind: "error", message: data.error ?? "Save failed — try again." } }));
        return;
      }
      setSaving((s) => ({ ...s, [key]: { kind: "saved" } }));
    } catch {
      setRows(previous);
      setSaving((s) => ({ ...s, [key]: { kind: "error", message: "Network hiccup — give it another shot." } }));
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {rows.map((row) => {
        const key = `${row.subdomain}.${row.base_domain}`;
        const fallback = themeForDomain(row.base_domain);
        const active = themeById(row.theme) ?? fallback;
        const state = saving[key] ?? { kind: "idle" };
        return (
          <div key={key} className="flex flex-wrap items-center gap-3">
            <ThemeSwatch theme={active} />
            <a href={`https://${key}`} className="min-w-0 font-mono text-sm hover:underline">
              <span className="truncate">{key}</span>
            </a>
            <select
              aria-label={`Theme for ${key}`}
              value={row.theme ?? ""}
              disabled={state.kind === "busy"}
              onChange={(e) => setTheme(row, e.target.value || null)}
              className={SELECT_CLASSES}
            >
              <option value="">Domain default — {fallback.styleName}</option>
              {THEMES.map((t) => (
                <option key={t.styleId} value={t.styleId}>
                  {t.styleName} ({t.mode})
                </option>
              ))}
            </select>
            <span className="w-14 text-xs text-muted-foreground" aria-live="polite">
              {state.kind === "busy" && "Saving…"}
              {state.kind === "saved" && <span className="text-accent">Saved ✓</span>}
            </span>
            {state.kind === "error" && (
              <p className="w-full text-xs text-destructive" role="alert">
                {state.message}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ThemeSwatch({ theme }: { theme: DomainTheme }) {
  return (
    <span
      className={cn(theme.className, "flex h-7 items-center gap-1 rounded-md border px-2")}
      style={{ background: "var(--background)", borderColor: "var(--border)" }}
      title={theme.styleName}
    >
      <span className="h-3 w-3 rounded-full" style={{ background: "var(--primary)" }} />
      <span className="h-3 w-3 rounded-full" style={{ background: "var(--accent)" }} />
      <span className="h-3 w-3 rounded-full border" style={{ background: "var(--card)", borderColor: "var(--border)" }} />
    </span>
  );
}
