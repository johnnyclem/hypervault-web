"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type JobRow = {
  id: string;
  kind: string;
  status: "succeeded" | "failed";
  label: string;
  result: { changed?: boolean; message?: string } | null;
  error: string | null;
};

const POLL_MS = 20_000;

export function JobNotifications() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/jobs");
        const data = await res.json();
        if (!cancelled && Array.isArray(data.jobs)) setJobs(data.jobs);
      } catch {
      }
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function dismiss(job: JobRow) {
    setJobs((prev) => prev.filter((j) => j.id !== job.id));
    void fetch(`/api/jobs/${job.id}`, { method: "POST" });
    if (job.status === "succeeded" && job.result?.changed) router.refresh();
  }

  if (jobs.length === 0) return null;
  const job = jobs[0];
  const ok = job.status === "succeeded";

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-xl sm:inset-x-auto sm:right-4 sm:left-auto"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold">
          {ok ? "✓" : "⚠️"} {job.label || "Background job finished"}
        </p>
        <button
          type="button"
          onClick={() => dismiss(job)}
          aria-label="Dismiss"
          className="shrink-0 rounded-lg px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ✕
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        {ok ? job.result?.message ?? "Done." : job.error ?? "It failed — try again."}
      </p>
      <div className="flex items-center justify-between gap-2">
        {jobs.length > 1 && <p className="text-xs text-muted-foreground">+{jobs.length - 1} more waiting</p>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => dismiss(job)}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
