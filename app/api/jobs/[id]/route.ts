import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingJobsTableHint } from "@/lib/supabase/errors";

export const dynamic = "force-dynamic";

const JOB_COLUMNS = "id, kind, status, label, result, error, created_at, started_at, finished_at, acknowledged_at";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { id } = await params;
  const { data: job, error } = await admin
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("id", id)
    .eq("user_id", auth.identity.userId)
    .maybeSingle();

  if (error) {
    const hint = missingJobsTableHint(error);
    return NextResponse.json({ error: hint ?? error.message }, { status: hint ? 503 : 500 });
  }
  if (!job) return NextResponse.json({ error: "No job matching that id." }, { status: 404 });

  return NextResponse.json({ job });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { id } = await params;
  const { error } = await admin
    .from("jobs")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", auth.identity.userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
