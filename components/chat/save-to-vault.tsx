"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { extractChatArtifact } from "@/lib/chat/artifact";

type SaveResult = {
  url: string;
  slug: string;
  duplicate?: boolean;
  visibility?: string;
  message: string;
};

const MAX_SOURCE_PROMPT_CHARS = 10_000;

export function SaveToVault({
  content,
  sourcePrompt,
  tag = "chat",
}: {
  content: string;
  sourcePrompt?: string;
  tag?: string;
}) {
  const artifact = useMemo(() => extractChatArtifact(content), [content]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!artifact) return null;

  async function save() {
    if (!artifact || busy || result) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: artifact.title ?? sourcePrompt?.trim().slice(0, 80) ?? "Chat artifact",
          content: artifact.content,
          tags: [tag],
          source_prompt: sourcePrompt?.trim().slice(0, MAX_SOURCE_PROMPT_CHARS) || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Saving failed — try again.");
        return;
      }
      setResult(data);
    } catch {
      setError("Network hiccup — nothing was saved, try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-2">
      {!result && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "⚡ Save to Vault"}
          </Button>
          <span className="text-[10px] text-muted-foreground">
            {artifact.kind === "jsx" ? "React component" : "HTML page"} detected
            {artifact.title ? ` — “${artifact.title}”` : ""}
          </span>
        </div>
      )}
      {result && (
        <div className="flex flex-col gap-1 text-xs" role="status">
          <span className="text-accent">
            {result.duplicate ? "Already in your vault — here's its permanent link." : "Saved to your vault."}
          </span>
          {result.visibility === "private" && (
            <span className="text-muted-foreground">
              🔒 Private — only you can open it. Invite someone or make it public from your vault.
            </span>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={result.url}
              target="_blank"
              rel="noreferrer"
              className="max-w-full truncate font-mono underline underline-offset-4"
            >
              {result.url}
            </a>
            <Button size="sm" variant="ghost" onClick={copyLink}>
              {copied ? "Copied!" : "Copy link"}
            </Button>
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
