"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type Snapshot = { title: string; content: string; tags: string[] } | null;

type Conflict = {
  memory_id: string;
  base: Snapshot;
  ours: Snapshot;
  theirs: Snapshot;
};

type Resolution = "ours" | "theirs" | { title: string; content: string };

export function MergeDialog({
  source,
  target,
  onClose,
  onMerged,
}: {
  source: string;
  target: string;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [resolutions, setResolutions] = useState<Map<string, Resolution>>(new Map());
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  async function merge() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mind/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          target,
          resolutions: [...resolutions.entries()].map(([memory_id, resolution]) => ({ memory_id, resolution })),
        }),
      });
      const data = await res.json();
      if (res.status === 409 && Array.isArray(data.conflicts)) {
        setConflicts(data.conflicts);
        setError(data.error ?? "Resolve the conflicts below, then merge again.");
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Merge failed.");
        return;
      }
      onMerged();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  function resolve(memoryId: string, resolution: Resolution) {
    setResolutions((prev) => new Map(prev).set(memoryId, resolution));
    setEditing(null);
  }

  const unresolved = conflicts.filter((c) => !resolutions.has(c.memory_id));

  return (
    <Card className="border-accent/50">
      <CardHeader>
        <CardTitle className="text-base">
          Merge <span className="font-mono">{source}</span> into <span className="font-mono">{target}</span>
        </CardTitle>
        <CardDescription>
          Memories only one branch touched merge automatically; links merge set-wise. Conflicts below need
          your pick.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {conflicts.map((c) => {
          const picked = resolutions.get(c.memory_id);
          const title = c.ours?.title ?? c.theirs?.title ?? "(deleted)";
          return (
            <div key={c.memory_id} className="flex flex-col gap-2 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{title}</p>
                {picked && (
                  <Badge variant="accent" className="text-[10px]">
                    {picked === "ours" ? `keeping ${target}` : picked === "theirs" ? `taking ${source}` : "hand-merged"}
                  </Badge>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ["ours", target, c.ours],
                  ["theirs", source, c.theirs],
                ] as const).map(([side, label, snapshot]) => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => resolve(c.memory_id, side)}
                    className={`flex flex-col gap-1 rounded-lg border p-2 text-left text-xs transition-colors hover:border-accent ${
                      picked === side ? "border-accent bg-accent/5" : "border-border"
                    }`}
                  >
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">
                      {label} {snapshot ? "" : "(deleted here)"}
                    </span>
                    {snapshot && (
                      <>
                        <span className="font-semibold">{snapshot.title}</span>
                        <span className="line-clamp-4 whitespace-pre-wrap text-muted-foreground">
                          {snapshot.content}
                        </span>
                      </>
                    )}
                  </button>
                ))}
              </div>
              <div>
                {editing === c.memory_id ? (
                  <div className="flex flex-col gap-2">
                    <Textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} rows={5} />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => resolve(c.memory_id, { title, content: editDraft })}
                        disabled={!editDraft.trim()}
                      >
                        Use this version
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      setEditing(c.memory_id);
                      setEditDraft(c.ours?.content ?? c.theirs?.content ?? "");
                    }}
                  >
                    Edit manually…
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center gap-2">
          <Button onClick={merge} disabled={busy || (conflicts.length > 0 && unresolved.length > 0)}>
            {busy
              ? "Merging…"
              : conflicts.length > 0
                ? `Merge with ${resolutions.size} resolution${resolutions.size === 1 ? "" : "s"}`
                : "Merge"}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {unresolved.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {unresolved.length} conflict{unresolved.length === 1 ? "" : "s"} left to resolve
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
