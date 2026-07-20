"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Backend = { id: string; name: string; provider: string };

export function RepairButton({
  slug,
  title,
  autoOpen = false,
  autoRenderError = null,
}: {
  slug: string;
  title: string;
  autoOpen?: boolean;
  autoRenderError?: string | null;
}) {
  const [open, setOpen] = useState(autoOpen);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        title={`Attempt an automatic repair of ${title}`}
      >
        🔧 Fix it
      </Button>
      {open && (
        <RepairDialog
          slug={slug}
          title={title}
          onClose={() => setOpen(false)}
          initialRenderError={autoOpen ? autoRenderError : null}
        />
      )}
    </>
  );
}

type RepairState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; changed: boolean; message: string }
  | { status: "error"; message: string; needsBackend?: boolean };

type JobResult = { changed?: boolean; message?: string } | null;
type Job = { status: "pending" | "running" | "succeeded" | "failed"; result: JobResult; error: string | null };

const JOB_POLL_MS = 2_000;

function RepairDialog({
  slug,
  title,
  onClose,
  initialRenderError = null,
}: {
  slug: string;
  title: string;
  onClose: () => void;
  initialRenderError?: string | null;
}) {
  const router = useRouter();
  const [backends, setBackends] = useState<Backend[] | null>(null);
  const [backendId, setBackendId] = useState("");
  const [state, setState] = useState<RepairState>({ status: "idle" });
  const [renderError] = useState(initialRenderError);
  const ranRefresh = useRef(false);
  const pollCancelled = useRef(false);
  useEffect(() => () => {
    pollCancelled.current = true;
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/backends", { signal: controller.signal });
        const data = await res.json();
        if (Array.isArray(data.backends)) {
          setBackends(data.backends);
          if (data.backends[0]) setBackendId(data.backends[0].id);
        } else {
          setBackends([]);
        }
      } catch {
        if (!controller.signal.aborted) setBackends([]);
      }
    })();
    return () => controller.abort();
  }, []);

  function close() {
    if (ranRefresh.current) router.refresh();
    onClose();
  }

  async function run() {
    setState({ status: "running" });
    try {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(slug)}/repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(backendId ? { backend_id: backendId } : {}),
          ...(renderError ? { render_error: renderError } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: data.error ?? "The repair failed.", needsBackend: data.needs_backend });
        return;
      }
      pollJob(data.job_id);
    } catch {
      setState({ status: "error", message: "Network hiccup — try again." });
    }
  }

  async function pollJob(jobId: string) {
    while (!pollCancelled.current) {
      let job: Job | null = null;
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        const data = await res.json();
        job = res.ok ? (data.job as Job) : null;
      } catch {
      }

      if (job?.status === "succeeded") {
        if (job.result?.changed) ranRefresh.current = true;
        setState({ status: "done", changed: Boolean(job.result?.changed), message: job.result?.message ?? "Done." });
        void fetch(`/api/jobs/${jobId}`, { method: "POST" });
        return;
      }
      if (job?.status === "failed") {
        setState({ status: "error", message: job.error ?? "The repair failed." });
        void fetch(`/api/jobs/${jobId}`, { method: "POST" });
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
    }
  }

  const running = state.status === "running";
  const hasBackends = backends !== null && backends.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label={`Repair ${title}`}
    >
      <div
        className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-bold">🔧 Attempt a repair</h2>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{title}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-lg px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <p className="text-sm text-muted-foreground">
          {renderError
            ? "A coding model will look at the error the browser actually hit and try to fix its cause " +
              "— syntax or runtime — so the page renders. It won't finish half-built features; it just " +
              "gets the artifact to load."
            : "A coding model will try to fix syntax errors — an unbalanced brace, an unclosed tag, a stray " +
              "token — so the page renders. It won't finish half-built features; it just gets the artifact " +
              "to load."}
        </p>

        {renderError && (
          <div className="rounded-lg border border-border bg-muted/50 p-2">
            <p className="text-xs font-semibold text-muted-foreground">Captured render error</p>
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-foreground">
              {renderError}
            </pre>
          </div>
        )}

        {backends === null ? (
          <p className="text-sm text-muted-foreground">Loading your backends…</p>
        ) : !hasBackends ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              No LLM backend is connected yet. Connect one — OpenAI, Anthropic, a local model, anything —
              and it becomes the repair engine.
            </p>
            <Link href="/chat" onClick={close}>
              <Button size="sm" variant="secondary">
                Connect a backend
              </Button>
            </Link>
          </div>
        ) : (
          <>
            {backends.length > 1 && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Repair with</span>
                <select
                  value={backendId}
                  onChange={(e) => setBackendId(e.target.value)}
                  disabled={running}
                  className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
                >
                  {backends.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {state.status === "done" ? (
              <div className="flex flex-col gap-3">
                <p className={`text-sm ${state.changed ? "text-foreground" : "text-muted-foreground"}`}>
                  {state.changed ? "✓ " : "ℹ️ "}
                  {state.message}
                </p>
                <div className="flex flex-wrap gap-2">
                  {state.changed && (
                    <a href={`/a/${slug}`} target="_blank" rel="noreferrer">
                      <Button size="sm">Open artifact ↗</Button>
                    </a>
                  )}
                  <Button size="sm" variant="ghost" onClick={close}>
                    Close
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={run} disabled={running || !backendId}>
                  {running ? "Repairing…" : "Attempt repair"}
                </Button>
                {state.status === "error" && (
                  <span className="text-xs text-destructive">{state.message}</span>
                )}
              </div>
            )}

            {running && (
              <p className="text-xs text-muted-foreground">
                This can take up to a minute for a big file — the model rewrites the whole thing. It&apos;s
                running in the background now, so feel free to close this window; you&apos;ll see the result
                next time you&apos;re in your vault.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
