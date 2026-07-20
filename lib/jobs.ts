import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { missingJobsTableHint } from "@/lib/supabase/errors";

export type JobStatus = "pending" | "running" | "succeeded" | "failed";

export type JobRow = {
  id: string;
  kind: string;
  status: JobStatus;
  label: string;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  acknowledged_at: string | null;
};

export async function startJob<T extends Record<string, unknown> | null>(
  admin: SupabaseClient,
  opts: { userId: string; kind: string; label?: string; input?: Record<string, unknown> },
  work: () => Promise<T>
): Promise<{ id: string } | { error: string }> {
  const { data: job, error } = await admin
    .from("jobs")
    .insert({
      user_id: opts.userId,
      kind: opts.kind,
      label: opts.label ?? "",
      input: opts.input ?? {},
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !job) {
    const hint = error ? missingJobsTableHint(error) : null;
    return { error: hint ?? error?.message ?? "Could not create the background job." };
  }

  const jobId = job.id as string;

  after(async () => {
    await admin
      .from("jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", jobId);
    try {
      const result = await work();
      await admin
        .from("jobs")
        .update({ status: "succeeded", result, finished_at: new Date().toISOString() })
        .eq("id", jobId);
    } catch (err) {
      await admin
        .from("jobs")
        .update({
          status: "failed",
          error: err instanceof Error ? err.message : "The job failed.",
          finished_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    }
  });

  return { id: jobId };
}
