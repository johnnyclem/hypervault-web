import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingJobsTableHint } from "@/lib/supabase/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data: jobs, error } = await admin
    .from("jobs")
    .select("id, kind, status, label, result, error, created_at, started_at, finished_at, acknowledged_at")
    .eq("user_id", auth.identity.userId)
    .in("status", ["succeeded", "failed"])
    .is("acknowledged_at", null)
    .order("finished_at", { ascending: false })
    .limit(20);

  if (error) {
    const hint = missingJobsTableHint(error);
    return NextResponse.json({ error: hint ?? error.message }, { status: hint ? 503 : 500 });
  }

  return NextResponse.json({ jobs: jobs ?? [] });
}
