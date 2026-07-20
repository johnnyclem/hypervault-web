import { NextResponse, type NextRequest } from "next/server";
import { generateDreamsForUser } from "@/lib/dreaming";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MIN_HOURS_BETWEEN_RUNS = 12;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  const provided = auth?.startsWith("Bearer ") ? auth.slice(7) : req.nextUrl.searchParams.get("secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  }

  const { data: users, error } = await admin
    .from("profiles")
    .select("id, dreaming_last_run_at")
    .eq("dreaming_enabled", true);
  if (error) {
    return NextResponse.json(
      { error: "Dreaming isn't provisioned in the database yet — run supabase/migrations/0024_dreaming.sql." },
      { status: 503 }
    );
  }

  const cutoff = Date.now() - MIN_HOURS_BETWEEN_RUNS * 60 * 60 * 1000;
  let runs = 0;
  let connections = 0;
  let skipped = 0;
  const failures: { user_id: string; error: string }[] = [];

  for (const u of users ?? []) {
    if (u.dreaming_last_run_at && new Date(u.dreaming_last_run_at).getTime() > cutoff) {
      skipped++;
      continue;
    }
    try {
      const summary = await generateDreamsForUser(admin, u.id);
      if (summary.runId) {
        runs++;
        connections += summary.counts.total;
      }
    } catch (e) {
      failures.push({ user_id: u.id, error: e instanceof Error ? e.message : "unknown error" });
    }
  }

  return NextResponse.json({
    ok: true,
    eligible: users?.length ?? 0,
    skipped,
    runs_created: runs,
    connections_staged: connections,
    failures,
  });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
