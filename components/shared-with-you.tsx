"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type SharedArtifact = {
  share_id: string;
  slug: string;
  title: string;
  type: string;
  is_jsx: boolean;
  owner: string;
  created_at: string;
};

export function SharedWithYou({ items }: { items: SharedArtifact[] }) {
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Shared with you</h2>
        <p className="text-sm text-muted-foreground">
          Artifacts other people invited you to — they stay in their vault, but open for your account.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.share_id}>
            <Card>
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{item.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">{item.is_jsx ? "react" : item.type}</Badge>
                    <span>from {item.owner}</span>
                    <span>{new Date(item.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <a href={`/a/${item.slug}`} target="_blank" rel="noreferrer">
                    <Button variant="secondary" size="sm">
                      Open ↗
                    </Button>
                  </a>
                  <LeaveButton shareId={item.share_id} title={item.title} />
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LeaveButton({ shareId, title }: { shareId: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/shares", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ share_id: shareId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't leave right now.");
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
        onClick={leave}
        onBlur={() => setConfirming(false)}
        disabled={busy}
        aria-label={confirming ? `Really leave ${title}?` : `Leave ${title}`}
      >
        {busy ? "Leaving…" : confirming ? "Really leave?" : "Leave"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
