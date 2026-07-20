"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { REDEEM_MESSAGES } from "@/lib/invites";

export function InviteRedeemForm({ initialError }: { initialError?: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(
    initialError ? (REDEEM_MESSAGES[initialError] ?? REDEEM_MESSAGES.invalid) : null
  );
  const [loading, setLoading] = useState(false);

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/invite/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && (body.result === "ok" || body.result === "already_approved")) {
        window.location.href = "/vault";
        return;
      }
      setError(REDEEM_MESSAGES[body.result as string] ?? body.error ?? "Could not redeem that code.");
    } catch {
      setError("Network hiccup — try again.");
    }
    setLoading(false);
  }

  return (
    <form onSubmit={redeem} className="flex w-full flex-col items-center gap-3">
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="HV-XXXX-XXXX"
        className="text-center font-mono uppercase tracking-widest"
        aria-label="Invite code"
      />
      <Button type="submit" disabled={loading || !code.trim()} className="w-full">
        {loading ? "Checking…" : "Redeem invite code"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
