"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type ApiKeyRow = { id: string; key_prefix: string; created_at: string; last_used_at: string | null };

export function ApiKeysCard({ keys }: { keys: ApiKeyRow[] }) {
  const router = useRouter();
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function createKey() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/keys", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't create a key right now.");
        return;
      }
      setFreshKey(data.key);
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(id: string) {
    if (confirmingId !== id) {
      setConfirmingId(id);
      return;
    }
    setConfirmingId(null);
    setRevokingId(id);
    setError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't revoke that key right now.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent API keys</CardTitle>
        <CardDescription>
          Give one to the HyperVault MCP server (sent as <code className="font-mono">X-HyperVault-Key</code>) so
          your agents can save straight to this vault.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {freshKey && (
          <div className="rounded-xl border border-accent/50 bg-accent/10 p-3 text-sm">
            <p className="font-semibold text-accent">Copy this key now — it won&apos;t be shown again:</p>
            <code className="mt-1 block break-all font-mono text-xs">{freshKey}</code>
          </div>
        )}
        {keys.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-2">
                <code className="font-mono">{k.key_prefix}…</code>
                <span className="flex items-center gap-2">
                  <span className="text-xs">
                    {k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleDateString()}` : "never used"}
                  </span>
                  <Button
                    variant={confirmingId === k.id ? "destructive" : "ghost"}
                    size="sm"
                    onClick={() => revokeKey(k.id)}
                    onBlur={() => setConfirmingId((c) => (c === k.id ? null : c))}
                    disabled={revokingId === k.id}
                  >
                    {revokingId === k.id ? "Revoking…" : confirmingId === k.id ? "Really revoke?" : "Revoke"}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button variant="secondary" size="sm" onClick={createKey} disabled={busy}>
          {busy ? "Generating…" : "Generate new key"}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
