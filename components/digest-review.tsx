"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type DigestSegmentView = {
  ordinal: number;
  title: string;
  summary: string;
  tags: string[];
  reason: string;
};

export type DigestLinkView = { a: number; b: number; kind: "sequence" | "theme" };

export type DigestRunView = {
  id: string;
  source_memory_id: string;
  source_title: string;
  strategy: "chat" | "headings" | "rules" | "none";
  created_at: string;
  segments: DigestSegmentView[];
  links: DigestLinkView[];
};

const STRATEGY_LABEL: Record<DigestRunView["strategy"], string> = {
  chat: "chat transcript",
  headings: "document sections",
  rules: "thematic breaks",
  none: "content",
};

export function DigestReview({
  initialEnabled,
  runs,
}: {
  initialEnabled: boolean;
  runs: DigestRunView[];
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [togglingBusy, setTogglingBusy] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setTogglingBusy(true);
    setError(null);
    setNotice(null);
    setEnabled(next);
    try {
      const res = await fetch("/api/digest/settings", {
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

  async function decide(runId: string, decision: "accept" | "reject") {
    setBusyIds((prev) => new Set([...prev, runId]));
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, decision }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't record that decision.");
        return;
      }
      if (data.message) setNotice(data.message);
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            🍽️ Digesting
            <Badge variant={enabled ? "accent" : "secondary"}>{enabled ? "on" : "off"}</Badge>
          </CardTitle>
          <CardDescription>
            A big import or a pasted chat can land as one memory when it&rsquo;s really many. Digesting
            reads a single piece of content, proposes how to split it into discrete memories, and stages
            the split here for review — like a pull request. Accepting rewrites the one memory into the
            pieces, wired together with implicit links; nothing changes until you say so.
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
              <span className="font-semibold text-foreground">Auto-digest on import</span>
              <span className="ml-2 text-muted-foreground">
                propose a split whenever splittable content is memorized
              </span>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            You can always digest a memory on demand from its card in the Memory Control Panel — the
            toggle only controls the automatic proposals.
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {notice && <p className="text-xs text-accent">{notice}</p>}
        </CardContent>
      </Card>

      {runs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No digests to review. Open a long memory in the{" "}
            <span className="font-medium text-foreground">Memory Control Panel</span> and hit{" "}
            <span className="font-medium text-foreground">Digest</span> to propose a split.
          </CardContent>
        </Card>
      ) : (
        runs.map((run) => {
          const busy = busyIds.has(run.id);
          const themeLinks = run.links.filter((l) => l.kind === "theme");
          return (
            <Card key={run.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base">
                      Split &ldquo;{run.source_title || "Untitled memory"}&rdquo;
                    </CardTitle>
                    <CardDescription>
                      {run.segments.length} pieces · detected as {STRATEGY_LABEL[run.strategy]} ·{" "}
                      {new Date(run.created_at).toLocaleDateString()}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="accent"
                      disabled={busy}
                      onClick={() => decide(run.id, "accept")}
                    >
                      {busy ? "Applying…" : "Apply split"}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => decide(run.id, "reject")}>
                      Keep whole
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <ol className="flex flex-col gap-2">
                  {run.segments.map((s) => (
                    <li
                      key={s.ordinal}
                      className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {s.ordinal + 1}.
                        </span>
                        <span className="font-medium">{s.title}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {s.reason}
                        </Badge>
                      </div>
                      {s.summary && <p className="mt-1 text-xs text-muted-foreground">{s.summary}</p>}
                      {s.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {s.tags.slice(0, 6).map((t) => (
                            <Badge key={t} variant="secondary" className="text-[10px]">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Implicit links:</span> the pieces stay
                  chained in reading order
                  {themeLinks.length > 0
                    ? `, plus ${themeLinks.length} thematic link${themeLinks.length === 1 ? "" : "s"} between related pieces`
                    : ""}
                  .
                </p>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
