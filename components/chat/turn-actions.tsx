"use client";

import { useMemo, useState } from "react";
import {
  Brain,
  Check,
  Copy,
  Loader2,
  Share,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { extractChatArtifact } from "@/lib/chat/artifact";
import { shareTitle, wrapTextAsHtmlPage } from "@/lib/chat/share";
import { SpeakButton } from "@/components/chat/speak-button";

export type TurnFeedback = "up" | "down" | null;

const MAX_SOURCE_PROMPT_CHARS = 10_000;

const ICON_BUTTON =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type ShareResult =
  | { kind: "artifact"; url: string; visibility?: string }
  | { kind: "memory"; message: string };

export function TurnActions({
  messageId,
  content,
  sourcePrompt,
  feedback,
  onFeedbackChange,
}: {
  messageId?: string;
  content: string;
  sourcePrompt?: string;
  feedback: TurnFeedback;
  onFeedbackChange: (feedback: TurnFeedback) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState<"artifact" | "memory" | null>(null);
  const [shareResult, setShareResult] = useState<ShareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const artifact = useMemo(() => extractChatArtifact(content), [content]);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't reach the clipboard — select the text to copy it.");
    }
  }

  async function rate(next: Exclude<TurnFeedback, null>) {
    if (!messageId) return;
    const value = feedback === next ? null : next;
    const previous = feedback;
    onFeedbackChange(value);
    setError(null);
    try {
      const res = await fetch(`/api/messages/${messageId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        onFeedbackChange(previous);
        setError(data.error ?? "Couldn't save your rating — try again.");
      }
    } catch {
      onFeedbackChange(previous);
      setError("Network hiccup — your rating wasn't saved, try again.");
    }
  }

  async function saveAsArtifact() {
    if (shareBusy) return;
    setShareBusy("artifact");
    setError(null);
    try {
      const title = artifact?.title ?? shareTitle(content, sourcePrompt);
      const body = artifact
        ? { title, content: artifact.content, tags: ["chat"] }
        : { title, content: wrapTextAsHtmlPage(content, title), tags: ["chat"], force_html: true };
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          source_prompt: sourcePrompt?.trim().slice(0, MAX_SOURCE_PROMPT_CHARS) || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Saving failed — try again.");
        return;
      }
      setShareResult({ kind: "artifact", url: data.url, visibility: data.visibility });
      setShareOpen(false);
    } catch {
      setError("Network hiccup — nothing was saved, try again.");
    } finally {
      setShareBusy(null);
    }
  }

  async function saveAsMemory() {
    if (shareBusy) return;
    setShareBusy("memory");
    setError(null);
    try {
      const res = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: shareTitle(content, sourcePrompt),
          content,
          tags: ["chat"],
          source: "chat",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Memorizing failed — try again.");
        return;
      }
      setShareResult({ kind: "memory", message: data.message ?? "Memorized." });
      setShareOpen(false);
    } catch {
      setError("Network hiccup — nothing was saved, try again.");
    } finally {
      setShareBusy(null);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={copyText}
          aria-label={copied ? "Copied" : "Copy reply"}
          title={copied ? "Copied" : "Copy reply"}
          className={ICON_BUTTON}
        >
          {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setShareOpen((v) => !v)}
          aria-label="Share reply"
          aria-expanded={shareOpen}
          title="Share reply"
          className={`${ICON_BUTTON} ${shareOpen ? "bg-muted text-foreground" : ""}`}
        >
          <Share className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => rate("up")}
          disabled={!messageId}
          aria-label="Good reply"
          aria-pressed={feedback === "up"}
          title={messageId ? "Good reply — more like this" : "Rating unavailable for this message"}
          className={`${ICON_BUTTON} disabled:opacity-40 ${feedback === "up" ? "text-accent" : ""}`}
        >
          <ThumbsUp className={`h-4 w-4 ${feedback === "up" ? "fill-current" : ""}`} />
        </button>
        <button
          type="button"
          onClick={() => rate("down")}
          disabled={!messageId}
          aria-label="Bad reply"
          aria-pressed={feedback === "down"}
          title={messageId ? "Bad reply — less like this" : "Rating unavailable for this message"}
          className={`${ICON_BUTTON} disabled:opacity-40 ${feedback === "down" ? "text-destructive" : ""}`}
        >
          <ThumbsDown className={`h-4 w-4 ${feedback === "down" ? "fill-current" : ""}`} />
        </button>
        {content.trim() && <SpeakButton text={content} />}
      </div>

      {shareOpen && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-background/60 p-1.5 text-xs">
          <ShareMenuItem onClick={copyText} icon={copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}>
            {copied ? "Copied!" : "Copy text"}
          </ShareMenuItem>
          <ShareMenuItem
            onClick={saveAsArtifact}
            busy={shareBusy === "artifact"}
            icon={<Sparkles className="h-3.5 w-3.5" />}
          >
            {artifact ? "Save code as artifact" : "Save as artifact"}
          </ShareMenuItem>
          <ShareMenuItem
            onClick={saveAsMemory}
            busy={shareBusy === "memory"}
            icon={<Brain className="h-3.5 w-3.5" />}
          >
            Save as memory
          </ShareMenuItem>
        </div>
      )}

      {shareResult?.kind === "artifact" && (
        <p className="text-xs" role="status">
          <span className="text-accent">In your vault: </span>
          <a
            href={shareResult.url}
            target="_blank"
            rel="noreferrer"
            className="break-all font-mono underline underline-offset-4"
          >
            {shareResult.url}
          </a>
          {shareResult.visibility === "private" && (
            <span className="text-muted-foreground">
              {" "}
              🔒 Private — invite someone or make it public from your vault before sharing the link.
            </span>
          )}
        </p>
      )}
      {shareResult?.kind === "memory" && (
        <p className="text-xs text-accent" role="status">
          {shareResult.message}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ShareMenuItem({
  onClick,
  icon,
  busy,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}
