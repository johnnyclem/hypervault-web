"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MergeDialog } from "@/components/merge-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type BranchInfo = {
  name: string;
  is_default: boolean;
  memory_count: number;
};

export function BranchSwitcher({ branches, current }: { branches: BranchInfo[]; current: string }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function goTo(branch: string) {
    router.push(branch === "main" ? "/vault/memory" : `/vault/memory?branch=${encodeURIComponent(branch)}`);
    router.refresh();
  }

  async function createBranch() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mind/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, from: current }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't create the branch.");
        return;
      }
      setName("");
      setCreating(false);
      goTo(data.name);
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteBranch() {
    if (!deleting) {
      setDeleting(true);
      return;
    }
    setDeleting(false);
    setError(null);
    try {
      const res = await fetch(`/api/mind/branches/${encodeURIComponent(current)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't delete the branch.");
        return;
      }
      goTo("main");
    } catch {
      setError("Network hiccup — try again.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">branch:</span>
        {branches.map((b) => (
          <button key={b.name} type="button" onClick={() => goTo(b.name)}>
            <Badge
              variant={b.name === current ? "accent" : "outline"}
              className="cursor-pointer font-mono text-[11px]"
            >
              {b.name}
              <span className="ml-1 opacity-60">{b.memory_count}</span>
            </Badge>
          </button>
        ))}
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setCreating((c) => !c)}>
          + branch
        </Button>
        {current !== "main" && (
          <>
            <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => setMerging(true)}>
              Merge into main
            </Button>
            <Button
              variant={deleting ? "destructive" : "ghost"}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={deleteBranch}
              onBlur={() => setDeleting(false)}
            >
              {deleting ? "Really delete?" : "Delete branch"}
            </Button>
          </>
        )}
      </div>

      {creating && (
        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                createBranch();
              }
            }}
            placeholder={`new branch from ${current}… (e.g. "ideas")`}
            className="h-8 max-w-xs font-mono text-xs"
            autoFocus
          />
          <Button size="sm" className="h-8" onClick={createBranch} disabled={busy || !name.trim()}>
            {busy ? "Branching…" : "Branch"}
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {merging && (
        <MergeDialog
          source={current}
          target="main"
          onClose={() => setMerging(false)}
          onMerged={() => {
            setMerging(false);
            goTo("main");
          }}
        />
      )}
    </div>
  );
}
