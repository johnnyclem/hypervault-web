"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isValidSecretName, SECRET_NAME_HINT } from "@/lib/secrets/name";

export type SecretRow = {
  id: string;
  name: string;
  kind: "opaque" | "header" | "oauth_grant";
  description: string | null;
  created_at: string;
  last_accessed_at: string | null;
};

export type SecretKeyRef = { id: string; key_prefix: string };

type GrantRow = { id: string; api_key_id: string; created_at: string };

const KIND_LABEL: Record<SecretRow["kind"], string> = {
  opaque: "opaque",
  header: "MCP header",
  oauth_grant: "OAuth grant",
};

export function SecretsCard({ secrets, apiKeys }: { secrets: SecretRow[]; apiKeys: SecretKeyRef[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [kind, setKind] = useState<SecretRow["kind"]>("opaque");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const trimmedName = name.trim();
  const nameInvalid = trimmedName.length > 0 && !isValidSecretName(trimmedName);

  async function createSecret() {
    if (!isValidSecretName(trimmedName) || !value) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, value, kind }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't save that secret.");
        return;
      }
      setName("");
      setValue("");
      setKind("opaque");
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSecret(secret: SecretRow) {
    if (confirmingId !== secret.id) {
      setConfirmingId(secret.id);
      return;
    }
    setConfirmingId(null);
    setError(null);
    try {
      const res = await fetch(`/api/secrets/${encodeURIComponent(secret.name)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't delete that secret.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AgentVault secrets</CardTitle>
        <CardDescription>
          Named, encrypted secrets your agents read by name through{" "}
          <code className="font-mono">GET /api/secrets/:name</code> — but only with an API key you
          explicitly grant. Values are shown once and never displayed again.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {secrets.length > 0 && (
          <ul className="flex flex-col gap-2 text-sm">
            {secrets.map((s) => (
              <li key={s.id} className="rounded-xl border border-border/60 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <code className="font-mono text-foreground">{s.name}</code>
                    <span className="ml-2 text-xs text-muted-foreground">{KIND_LABEL[s.kind]}</span>
                  </div>
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpanded((e) => (e === s.id ? null : s.id))}
                    >
                      {expanded === s.id ? "Hide grants" : "Grants"}
                    </Button>
                    <Button
                      variant={confirmingId === s.id ? "destructive" : "ghost"}
                      size="sm"
                      onClick={() => deleteSecret(s)}
                      onBlur={() => setConfirmingId((c) => (c === s.id ? null : c))}
                    >
                      {confirmingId === s.id ? "Really delete?" : "Delete"}
                    </Button>
                  </span>
                </div>
                {expanded === s.id && <GrantEditor secret={s} apiKeys={apiKeys} />}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 rounded-xl border border-border/60 p-2">
          <div className="flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="name (e.g. github-mcp-token)"
              aria-invalid={nameInvalid}
              className={`min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 text-sm font-mono ${
                nameInvalid ? "border-destructive" : "border-input"
              }`}
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as SecretRow["kind"])}
              className="rounded-md border border-input bg-transparent px-2 py-1 text-sm"
            >
              <option value="opaque">opaque</option>
              <option value="header">MCP header</option>
              <option value="oauth_grant">OAuth grant</option>
            </select>
          </div>
          <p className={`text-xs ${nameInvalid ? "text-destructive" : "text-muted-foreground"}`}>
            {SECRET_NAME_HINT}
          </p>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="value (encrypted at rest, shown once)"
            type="password"
            className="rounded-md border border-input bg-transparent px-2 py-1 text-sm font-mono"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={createSecret}
            disabled={busy || !isValidSecretName(trimmedName) || !value}
          >
            {busy ? "Saving…" : "Add secret"}
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function GrantEditor({ secret, apiKeys }: { secret: SecretRow; apiKeys: SecretKeyRef[] }) {
  const [granted, setGranted] = useState<Set<string> | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/secrets/${encodeURIComponent(secret.name)}/grants`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't load grants.");
        setGranted(new Set());
        return;
      }
      setGranted(new Set((data.grants as GrantRow[]).map((g) => g.api_key_id)));
    } catch {
      setError("Network hiccup — try again.");
      setGranted(new Set());
    }
  }, [secret.name]);

  if (granted === null && pending === null) {
    setPending("__loading__");
    void load().finally(() => setPending(null));
  }

  async function toggle(keyId: string, on: boolean) {
    setPending(keyId);
    setError(null);
    try {
      const res = await fetch(`/api/secrets/${encodeURIComponent(secret.name)}/grants`, {
        method: on ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key_id: keyId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't update that grant.");
        return;
      }
      setGranted((prev) => {
        const next = new Set(prev ?? []);
        if (on) next.add(keyId);
        else next.delete(keyId);
        return next;
      });
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setPending(null);
    }
  }

  if (apiKeys.length === 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        No API keys yet — generate one to grant read access.
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-border/40 pt-2">
      <p className="text-xs text-muted-foreground">Which keys may read this secret:</p>
      {apiKeys.map((k) => {
        const on = granted?.has(k.id) ?? false;
        return (
          <label key={k.id} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={on}
              disabled={pending === k.id || granted === null}
              onChange={(e) => toggle(k.id, e.target.checked)}
            />
            <code className="font-mono">{k.key_prefix}…</code>
          </label>
        );
      })}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
