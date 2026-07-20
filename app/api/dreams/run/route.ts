import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { generateDreamsForUser } from "@/lib/dreaming";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingDreamingSchemaHint } from "@/lib/supabase/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  try {
    const summary = await generateDreamsForUser(admin, auth.identity.userId);
    return NextResponse.json({
      run_id: summary.runId,
      counts: summary.counts,
      message: summary.runId
        ? `Dreamt up ${summary.counts.total} new connection${summary.counts.total === 1 ? "" : "s"} to review.`
        : "No new connections this time — your graph is already well woven.",
    });
  } catch (e) {
    const err = e as { code?: string; message: string };
    const hint = missingDreamingSchemaHint(err);
    return NextResponse.json(
      { error: hint ?? `Could not dream right now: ${err.message ?? "unknown error"}` },
      { status: hint ? 503 : 500 }
    );
  }
}
