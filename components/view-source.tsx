"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ViewSourceBadge({ slug, title, type }: { slug: string; title: string; type: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`View ${title} source`}
        aria-label={`View raw ${type} source of ${title}`}
        className="cursor-pointer rounded-full transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Badge variant="secondary">{type}</Badge>
      </button>
      {open && <SourceDialog slug={slug} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

function SourceDialog({ slug, title, onClose }: { slug: string; title: string; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/artifacts/${encodeURIComponent(slug)}/source`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not load the source.");
          return;
        }
        setContent(data.content ?? "");
      } catch {
        if (!controller.signal.aborted) setError("Network hiccup — try again.");
      }
    })();
    return () => controller.abort();
  }, [slug]);

  async function copy() {
    if (content == null) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Raw source of ${title}`}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-2xl flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-bold">Raw source</h2>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{title}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="secondary" size="sm" onClick={copy} disabled={content == null}>
              {copied ? "Copied!" : "Copy"}
            </Button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              ✕
            </button>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : content == null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <pre className="min-h-0 flex-1 select-text overflow-auto rounded-xl border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed whitespace-pre">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
