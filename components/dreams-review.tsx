"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type DreamEndpoint = { kind: "artifact" | "memory"; id: string; label: string; slug?: string };

export type DreamConnectionView = {
  id: string;
  edge_type: "artifact_artifact" | "memory_memory" | "memory_artifact";
  score: number;
  reason: string;
  a: DreamEndpoint;
  b: DreamEndpoint;
};

export type DreamRunView = {
  id: string;
  created_at: string;
  connections: DreamConnectionView[];
};

const EDGE_LABEL: Record<DreamConnectionView["edge_type"], string> = {
  artifact_artifact: "artifact ↔ artifact",
  memory_memory: "memory ↔ memory",
  memory_artifact: "memory ↔ artifact",
};

function endpointHref(e: DreamEndpoint): string | null {
  if (e.kind === "artifact" && e.slug) return `/a/${e.slug}`;
  if (e.kind === "memory") return `/vault/memory?open=${e.id}`;
  return null;
}

function EndpointChip({ e }: { e: DreamEndpoint }) {
  const href = endpointHref(e);
  const inner = (
    <span className="inline-flex items-center gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{e.kind}</span>
      <span className="font-medium">{e.label}</span>
    </span>
  );
  return href ? (
    <Link href={href} className="underline-offset-4 hover:underline">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function DreamsReview({
  initialEnabled,
  lastRunAt,
  runs,
}: {
  initialEnabled: boolean;
  lastRunAt: string | null;
  runs: DreamRunView[];
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [togglingBusy, setTogglingBusy] = useState(false);
  const [dreamingBusy, setDreamingBusy] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pendingCount = runs.reduce((n, r) => n + r.connections.length, 0);

  async function toggle(next: boolean) {
    setTogglingBusy(true);
    setError(null);
    setNotice(null);
    setEnabled(next);
    try {
      const res = await fetch("/api/dreams/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEnabled(!next);
        setError(data.error ?? "Couldn't update the setting.");
        return;
      }
      setEnabled(Boolean(data.enabled));
      router.refresh();
    } catch {
      setEnabled(!next);
      setError("Network hiccup — try again.");
    } finally {
      setTogglingBusy(false);
    }
  }

  async function dreamNow() {
    setDreamingBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/dreams/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't run a dream pass.");
        return;
      }
      setNotice(data.message ?? "Dreaming complete.");
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setDreamingBusy(false);
    }
  }

  async function decide(body: { id?: string; runId?: string; decision: "accept" | "reject" }, keys: string[]) {
    setBusyIds((prev) => new Set([...prev, ...keys]));
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/dreams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't record that decision.");
        return;
      }
      if (Array.isArray(data.failures) && data.failures.length > 0) {
        setError(`Some connections couldn't be merged: ${data.failures.map((f: { error: string }) => f.error).join("; ")}`);
      } else if (data.message) {
        setNotice(data.message);
      }
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        for (const k of keys) next.delete(k);
        return next;
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            💤 Dreaming
            <Badge variant={enabled ? "accent" : "secondary"}>{enabled ? "on" : "off"}</Badge>
          </CardTitle>
          <CardDescription>
            While you sleep, HyperVault looks for connections you never made by hand — between artifacts,
            between memories, and across the two — and stages them here for you to review, like a pull
            request. Nothing touches your live graph until you accept it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={enabled}
              disabled={togglingBusy}
              onChange={(e) => toggle(e.target.checked)}
            />
            <span>
              <span className="font-semibold text-foreground">Dream every night</span>
              <span className="ml-2 text-muted-foreground">
                run the discovery pass automatically once a day
              </span>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={dreamNow} disabled={dreamingBusy || !enabled}>
              {dreamingBusy ? "Dreaming…" : "Dream now"}
            </Button>
            {lastRunAt && (
              <span className="text-xs text-muted-foreground">
                Last dreamt {new Date(lastRunAt).toLocaleString()}
              </span>
            )}
          </div>
          {!enabled && (
            <p className="text-xs text-muted-foreground">
              Turn dreaming on to let the nightly pass start proposing connections. You can still
              &ldquo;Dream now&rdquo; once it&rsquo;s enabled.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          {notice && <p className="text-xs text-accent">{notice}</p>}
        </CardContent>
      </Card>

      {pendingCount === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No dreams to review right now. {enabled ? "Check back after tonight's pass" : "Enable dreaming"} —
            or hit <span className="font-medium text-foreground">Dream now</span>.
          </CardContent>
        </Card>
      ) : (
        runs.map((run) => (
          <Card key={run.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Dream from {new Date(run.created_at).toLocaleDateString()}</CardTitle>
                  <CardDescription>
                    {run.connections.length} proposed connection{run.connections.length === 1 ? "" : "s"} to review
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="accent"
                    disabled={busyIds.has(run.id)}
                    onClick={() =>
                      decide({ runId: run.id, decision: "accept" }, [run.id, ...run.connections.map((c) => c.id)])
                    }
                  >
                    Accept all
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyIds.has(run.id)}
                    onClick={() =>
                      decide({ runId: run.id, decision: "reject" }, [run.id, ...run.connections.map((c) => c.id)])
                    }
                  >
                    Reject all
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y divide-border/60">
                {run.connections.map((c) => {
                  const busy = busyIds.has(c.id) || busyIds.has(run.id);
                  return (
                    <li key={c.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <EndpointChip e={c.a} />
                          <span className="text-muted-foreground">↔</span>
                          <EndpointChip e={c.b} />
                          <Badge variant="outline" className="ml-1 text-[10px]">
                            {EDGE_LABEL[c.edge_type]}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{c.reason}</p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          variant="accent"
                          disabled={busy}
                          onClick={() => decide({ id: c.id, decision: "accept" }, [c.id])}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => decide({ id: c.id, decision: "reject" }, [c.id])}
                        >
                          Reject
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
