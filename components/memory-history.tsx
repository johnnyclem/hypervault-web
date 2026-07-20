"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Revision = {
  revision_id: string;
  op: "create" | "update" | "delete";
  title: string;
  summary: string;
  commit: {
    id: string;
    message: string;
    author_kind: "user" | "agent" | "system";
    author_key_prefix?: string;
    branch?: string;
    created_at: string;
  } | null;
};

type DiffLine = { kind: "add" | "del" | "ctx"; text: string };
type DiffPayload = {
  status?: string;
  diff: { hunks: { lines: DiffLine[] }[]; oversize: boolean };
};

function authorLabel(commit: NonNullable<Revision["commit"]>): string {
  if (commit.author_kind === "agent") return `agent ${commit.author_key_prefix ?? ""}`.trim();
  if (commit.author_kind === "system") return "system";
  return "you";
}

export function MemoryHistory({ memoryId, branch }: { memoryId: string; branch: string }) {
  const router = useRouter();
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDiff, setOpenDiff] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffPayload | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/memories/${memoryId}/history`);
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) setRevisions(data.revisions ?? []);
        else setError(data.error ?? "Couldn't load the history.");
      } catch {
        if (!cancelled) setError("Network hiccup — try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [memoryId]);

  async function toggleDiff(rev: Revision, older: Revision | undefined) {
    if (openDiff === rev.revision_id) {
      setOpenDiff(null);
      setDiff(null);
      return;
    }
    setOpenDiff(rev.revision_id);
    setDiff(null);
    if (!older?.commit || !rev.commit) return;
    try {
      const res = await fetch(
        `/api/mind/diff?from=${older.commit.id}&to=${rev.commit.id}&memory_id=${memoryId}`
      );
      const data = await res.json();
      if (res.ok) setDiff(data);
      else setError(data.error ?? "Couldn't diff those revisions.");
    } catch {
      setError("Network hiccup — try again.");
    }
  }

  async function restore(rev: Revision) {
    if (restoring !== rev.revision_id) {
      setRestoring(rev.revision_id);
      return;
    }
    setRestoring(null);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mind/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memory_id: memoryId, revision_id: rev.revision_id, branch }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't restore that revision.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!revisions) return <p className="text-sm text-muted-foreground">Loading history…</p>;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        History — {revisions.length} revision{revisions.length === 1 ? "" : "s"}
      </p>
      <ol className="flex flex-col gap-1.5">
        {revisions.map((rev, i) => {
          const older = revisions[i + 1];
          const isHead = i === 0;
          return (
            <li key={rev.revision_id} className="rounded-lg border border-border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant={rev.op === "delete" ? "outline" : "secondary"}
                    className={`font-mono text-[10px] uppercase${rev.op === "delete" ? " text-destructive" : ""}`}
                  >
                    {rev.op}
                  </Badge>
                  <span className="font-medium">{rev.commit?.message ?? rev.title}</span>
                  {rev.commit?.branch && rev.commit.branch !== branch && (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {rev.commit.branch}
                    </Badge>
                  )}
                </div>
                <span className="text-muted-foreground">
                  {rev.commit ? `${authorLabel(rev.commit)} · ${new Date(rev.commit.created_at).toLocaleString()}` : ""}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                {older && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => toggleDiff(rev, older)}
                  >
                    {openDiff === rev.revision_id ? "Hide diff" : "Diff"}
                  </Button>
                )}
                {!isHead && rev.op !== "delete" && (
                  <Button
                    variant={restoring === rev.revision_id ? "destructive" : "ghost"}
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => restore(rev)}
                    onBlur={() => setRestoring((r) => (r === rev.revision_id ? null : r))}
                    disabled={busy}
                  >
                    {restoring === rev.revision_id ? "Really restore?" : "Restore this version"}
                  </Button>
                )}
              </div>
              {openDiff === rev.revision_id && diff && (
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-2 font-mono text-[11px] leading-relaxed">
                  {diff.diff.oversize
                    ? "(content replaced — too large to diff line by line)"
                    : diff.diff.hunks.length === 0
                      ? "(no content change — title or tags only)"
                      : diff.diff.hunks.map((h, hi) => (
                          <span key={hi}>
                            {h.lines.map((line, li) => (
                              <span
                                key={li}
                                className={
                                  line.kind === "add"
                                    ? "block bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                    : line.kind === "del"
                                      ? "block bg-red-500/15 text-red-600 dark:text-red-400"
                                      : "block text-muted-foreground"
                                }
                              >
                                {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "} {line.text}
                              </span>
                            ))}
                          </span>
                        ))}
                </pre>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
