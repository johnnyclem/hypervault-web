import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { applyDreamConnection, type DreamEdgeType } from "@/lib/dreaming";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type DreamRow = {
  id: string;
  run_id: string;
  edge_type: DreamEdgeType;
  a_id: string;
  b_id: string;
  score: number;
  reason: string;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
};

type Endpoint = { kind: "artifact" | "memory"; id: string; label: string; slug?: string };

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
    .select("dreaming_enabled, dreaming_last_run_at")
    .eq("id", userId)
    .maybeSingle();

  const { data: runs, error: runsErr } = await admin
    .from("dream_runs")
    .select("id, created_at")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);
  if (runsErr) {
    return NextResponse.json(
      { error: "Dreaming isn't provisioned in the database yet — run supabase/migrations/0024_dreaming.sql." },
      { status: 503 }
    );
  }

  const runIds = (runs ?? []).map((r) => r.id);
  let dreams: DreamRow[] = [];
  if (runIds.length > 0) {
    const { data } = await admin
      .from("dream_connections")
      .select("id, run_id, edge_type, a_id, b_id, score, reason, status, created_at")
      .eq("user_id", userId)
      .eq("status", "pending")
      .in("run_id", runIds)
      .order("score", { ascending: false });
    dreams = (data ?? []) as DreamRow[];
  }

  const [{ data: artifacts }, { data: memories }] = await Promise.all([
    admin.from("artifacts").select("id, slug, title").eq("user_id", userId).limit(2000),
    admin.from("memories").select("id, title").eq("user_id", userId).limit(2000),
  ]);
  const artifactById = new Map((artifacts ?? []).map((a) => [a.id, a]));
  const memoryById = new Map((memories ?? []).map((m) => [m.id, m]));

  const artifactEndpoint = (id: string): Endpoint => {
    const a = artifactById.get(id);
    return { kind: "artifact", id, label: a?.title ?? "(deleted artifact)", slug: a?.slug };
  };
  const memoryEndpoint = (id: string): Endpoint => {
    const m = memoryById.get(id);
    return { kind: "memory", id, label: m?.title ?? "(deleted memory)" };
  };
  const endpoints = (d: DreamRow): { a: Endpoint; b: Endpoint } => {
    if (d.edge_type === "artifact_artifact") return { a: artifactEndpoint(d.a_id), b: artifactEndpoint(d.b_id) };
    if (d.edge_type === "memory_memory") return { a: memoryEndpoint(d.a_id), b: memoryEndpoint(d.b_id) };
    return { a: memoryEndpoint(d.a_id), b: artifactEndpoint(d.b_id) };
  };

  const byRun = new Map<string, ReturnType<typeof shapeConnection>[]>();
  function shapeConnection(d: DreamRow) {
    const { a, b } = endpoints(d);
    return { id: d.id, edge_type: d.edge_type, score: d.score, reason: d.reason, a, b };
  }
  for (const d of dreams) {
    const list = byRun.get(d.run_id) ?? [];
    list.push(shapeConnection(d));
    byRun.set(d.run_id, list);
  }

  const shapedRuns = (runs ?? [])
    .map((r) => ({ id: r.id, created_at: r.created_at, connections: byRun.get(r.id) ?? [] }))
    .filter((r) => r.connections.length > 0);

  return NextResponse.json({
    dreaming_enabled: profile?.dreaming_enabled ?? false,
    last_run_at: profile?.dreaming_last_run_at ?? null,
    pending_count: dreams.length,
    runs: shapedRuns,
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
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  if (!id && !runId) {
    return NextResponse.json({ error: "Send an id (one connection) or a runId (a whole run)." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const userId = auth.identity.userId;
  const accept = decision === "accept";

  let query = admin
    .from("dream_connections")
    .select("id, run_id, edge_type, a_id, b_id, status")
    .eq("user_id", userId)
    .eq("status", "pending");
  query = id ? query.eq("id", id) : query.eq("run_id", runId);
  const { data: targets, error: fetchErr } = await query;
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!targets || targets.length === 0) {
    return NextResponse.json(
      { error: "Nothing pending to decide — it may already have been reviewed." },
      { status: 404 }
    );
  }

  let applied = 0;
  let rejected = 0;
  const failures: { id: string; error: string }[] = [];
  const decidedAt = new Date().toISOString();
  const affectedRuns = new Set<string>();

  for (const t of targets as DreamRow[]) {
    affectedRuns.add(t.run_id);
    if (accept) {
      try {
        await applyDreamConnection(admin, auth.identity, t);
      } catch (e) {
        failures.push({ id: t.id, error: e instanceof Error ? e.message : "unknown error" });
        continue;
      }
    }
    const { error: updErr } = await admin
      .from("dream_connections")
      .update({ status: accept ? "accepted" : "rejected", decided_at: decidedAt })
      .eq("id", t.id)
      .eq("user_id", userId);
    if (updErr) {
      failures.push({ id: t.id, error: updErr.message });
      continue;
    }
    if (accept) applied++;
    else rejected++;
  }

  for (const rid of affectedRuns) {
    const { count } = await admin
      .from("dream_connections")
      .select("id", { count: "exact", head: true })
      .eq("run_id", rid)
      .eq("status", "pending");
    if ((count ?? 0) === 0) {
      await admin
        .from("dream_runs")
        .update({ status: "reviewed", reviewed_at: decidedAt })
        .eq("id", rid)
        .eq("user_id", userId);
    }
  }

  return NextResponse.json({
    accepted: applied,
    rejected,
    failures,
    message: accept
      ? `Merged ${applied} connection${applied === 1 ? "" : "s"} into your graph.`
      : `Dismissed ${rejected} connection${rejected === 1 ? "" : "s"}.`,
  });
}
