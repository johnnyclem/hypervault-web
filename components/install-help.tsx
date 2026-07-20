"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function InstallHelpButton({
  slug,
  title,
  isPwa,
}: {
  slug: string;
  title: string;
  isPwa: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        📲 Install
      </Button>
      {open && <InstallDialog slug={slug} title={title} isPwa={isPwa} onClose={() => setOpen(false)} />}
    </>
  );
}

function InstallDialog({
  slug,
  title,
  isPwa,
  onClose,
}: {
  slug: string;
  title: string;
  isPwa: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const link = typeof window === "undefined" ? `/a/${slug}` : `${window.location.origin}/a/${slug}`;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Add ${title} to your home screen`}
    >
      <div
        className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-bold">Add to your home screen</h2>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2">
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{link}</code>
          <Button variant="secondary" size="sm" onClick={copy}>
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>

        <ol className="flex flex-col gap-3 text-sm">
          <li className="flex gap-3">
            <StepNumber n={1} />
            <span>
              <span className="font-semibold">Open the link on your device</span> — copy it above
              and send it to yourself, or open this dashboard on your phone.
            </span>
          </li>
          <li className="flex gap-3">
            <StepNumber n={2} />
            <div className="flex flex-col gap-2">
              <span className="font-semibold">Then, on…</span>
              <span>
                <span className="font-semibold">iPhone &amp; iPad (Safari):</span> tap the Share
                button <ShareIcon />, scroll down, tap{" "}
                <span className="font-semibold">Add to Home Screen</span>, then{" "}
                <span className="font-semibold">Add</span>.
              </span>
              <span>
                <span className="font-semibold">Android (Chrome):</span> tap the ⋮ menu, then{" "}
                <span className="font-semibold">Add to Home screen</span> (or{" "}
                <span className="font-semibold">Install app</span>).
              </span>
              <span>
                <span className="font-semibold">Desktop (Chrome/Edge):</span> click the install
                icon at the right end of the address bar.
              </span>
            </div>
          </li>
        </ol>

        <p className="text-xs text-muted-foreground">
          {isPwa ? (
            <>This artifact is installable — it opens full-screen with its own icon, like a native app.</>
          ) : (
            <>
              This artifact was saved without &ldquo;Make it installable&rdquo;, so it opens as a regular
              browser page. Re-save it with the installable toggle on for the full app experience.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
      {n}
    </span>
  );
}

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mx-0.5 inline-block h-4 w-4 align-text-bottom"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Share icon"
      role="img"
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
    </svg>
  );
}
