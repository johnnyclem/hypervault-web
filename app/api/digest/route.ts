import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { applyDigest, internalLinks, type DigestStrategy } from "@/lib/digestion";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RunRow = {
  id: string;
  source_memory_id: string;
  source_title: string;
  strategy: DigestStrategy;
  segment_count: number;
  created_at: string;
};

type SegmentRow = {
  run_id: string;
  ordinal: number;
  new_memory_id: string;
  title: string;
  summary: string;
  tags: string[] | null;
  reason: string;
};

const DECISIONS = new Set(["accept", "reject"]);

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const userId = auth.identity.userId;

  const { data: profile } = await admin
    .from("profiles")
    .select("digestion_enabled")
    .eq("id", userId)
    .maybeSingle();

  const { data: runs, error: runsErr } = await admin
    .from("digest_runs")
    .select("id, source_memory_id, source_title, strategy, segment_count, created_at")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);
  if (runsErr) {
    return NextResponse.json(
      { error: "Digesting isn't provisioned in the database yet — run supabase/migrations/0025_digestion.sql." },
      { status: 503 }
    );
  }

  const runIds = (runs ?? []).map((r) => r.id);
  let segments: SegmentRow[] = [];
  if (runIds.length > 0) {
    const { data } = await admin
      .from("digest_segments")
      .select("run_id, ordinal, new_memory_id, title, summary, tags, reason")
      .eq("user_id", userId)
      .in("run_id", runIds)
      .order("ordinal", { ascending: true });
    segments = (data ?? []) as SegmentRow[];
  }

  const byRun = new Map<string, SegmentRow[]>();
  for (const s of segments) {
    const list = byRun.get(s.run_id) ?? [];
    list.push(s);
    byRun.set(s.run_id, list);
  }

  const shaped = (runs ?? [])
    .map((r: RunRow) => {
      const segs = byRun.get(r.id) ?? [];
      const links = internalLinks(
        segs.map((s) => ({
          ordinal: s.ordinal,
          title: s.title,
          content: "",
          summary: s.summary,
          tags: s.tags ?? [],
          reason: s.reason,
        }))
      );
      return {
        id: r.id,
        source_memory_id: r.source_memory_id,
        source_title: r.source_title,
        strategy: r.strategy,
        created_at: r.created_at,
        segments: segs.map((s) => ({
          ordinal: s.ordinal,
          title: s.title,
          summary: s.summary,
          tags: s.tags ?? [],
          reason: s.reason,
        })),
        links,
      };
    })
    .filter((r) => r.segments.length > 0);

  return NextResponse.json({
    digestion_enabled: profile?.digestion_enabled ?? false,
    pending_count: shaped.length,
    runs: shaped,
  });
}

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const decision = typeof body.decision === "string" ? body.decision : "";
  if (!DECISIONS.has(decision)) {
    return NextResponse.json({ error: 'decision must be "accept" or "reject".' }, { status: 400 });
  }
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  if (!runId) {
    return NextResponse.json({ error: "runId is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const userId = auth.identity.userId;

  const { data: run, error: runErr } = await admin
    .from("digest_runs")
    .select("id, status")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  if (runErr) return NextResponse.json({ error: runErr.message }, { status: 500 });
  if (!run) return NextResponse.json({ error: "No such digest run." }, { status: 404 });
  if (run.status !== "pending") {
    return NextResponse.json({ error: "This digest has already been reviewed." }, { status: 409 });
  }

  if (decision === "reject") {
    const { error } = await admin
      .from("digest_runs")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("user_id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ status: "rejected", message: "Digest dismissed — the memory was left whole." });
  }

  try {
    const result = await applyDigest(admin, auth.identity, runId);
    return NextResponse.json({
      status: "applied",
      commit_id: result.commitId,
      created: result.created,
      links: result.links,
      branch: result.branch,
      message: `Split into ${result.created} memories, wired with ${result.links} link${
        result.links === 1 ? "" : "s"
      }.`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Could not apply the digest: ${e instanceof Error ? e.message : "unknown error"}` },
      { status: 500 }
    );
  }
}
