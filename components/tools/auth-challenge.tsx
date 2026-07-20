"use client";

import { useState } from "react";
import { KeyRound, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { connectWithOAuth } from "@/components/tools/oauth-connect";
import type { ServerRow } from "@/components/tools/types";

export type AuthTarget = { url: string; name?: string; registryId?: string | null; serverId?: string };

export function AuthChallenge({
  target,
  onConnected,
  onCancel,
  compact = false,
}: {
  target: AuthTarget;
  onConnected: (server: ServerRow, message: string) => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const [mode, setMode] = useState<"choose" | "token">("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [headerName, setHeaderName] = useState("Authorization");

  const label = target.name?.trim() || new URL(target.url).hostname;

  async function authorize() {
    setBusy(true);
    setError(null);
    setNote(null);
    const result = await connectWithOAuth(target);
    setBusy(false);
    if (result.ok) {
      onConnected(result.server, result.message);
      return;
    }
    if ("cancelled" in result && result.cancelled) return;
    if ("oauthUnavailable" in result && result.oauthUnavailable) {
      setMode("token");
      setNote(result.error);
      return;
    }
    setError(result.error);
  }

  async function submitToken() {
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    const key = headerName.trim() || "Authorization";
    const value = key.toLowerCase() === "authorization" && !/\s/.test(token.trim()) ? `Bearer ${token.trim()}` : token.trim();
    try {
      const res = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: target.url,
          name: target.name,
          registry_id: target.registryId ?? undefined,
          headers: { [key]: value },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.auth_required ? "That token was rejected — check it and try again." : data.error ?? "Could not connect.");
        return;
      }
      onConnected(data.server as ServerRow, data.message ?? "Connected.");
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Lock className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="truncate">{label} needs authorization</span>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}

      {mode === "choose" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={authorize} disabled={busy} size="sm" className="gap-1.5">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
            {busy ? "Opening…" : "Authorize"}
          </Button>
          <button
            onClick={() => {
              setMode("token");
              setError(null);
            }}
            disabled={busy}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
          >
            use a token instead
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              disabled={busy}
              className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
            >
              cancel
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className={compact ? "flex flex-col gap-2" : "flex flex-col gap-2 sm:flex-row"}>
            <Input
              value={headerName}
              onChange={(e) => setHeaderName(e.target.value)}
              placeholder="Header"
              aria-label="Auth header name"
              className={compact ? "" : "sm:w-40"}
            />
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitToken()}
              placeholder="API token or key"
              aria-label="API token"
              className="flex-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={submitToken} disabled={busy || !token.trim()} size="sm" className="gap-1.5">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              Connect
            </Button>
            <button
              onClick={() => {
                setMode("choose");
                setError(null);
              }}
              disabled={busy}
              className="text-xs text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
            >
              back
            </button>
            {onCancel && (
              <button
                onClick={onCancel}
                disabled={busy}
                className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
              >
                cancel
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
