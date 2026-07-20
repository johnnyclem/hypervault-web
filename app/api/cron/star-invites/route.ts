import { NextResponse, type NextRequest } from "next/server";
import { isMissingInviteTable, INVITE_MIGRATION_HINT } from "@/lib/invite-schema";
import { sendWeeklyInvites, syncStargazers } from "@/lib/star-invites";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  const sync = await syncStargazers(admin);

  const summary = await sendWeeklyInvites(admin);

  if (summary.failures.some((f) => f.error && isMissingInviteTable({ message: f.error, code: undefined }))) {
    return NextResponse.json({ error: INVITE_MIGRATION_HINT, sync, summary }, { status: 503 });
  }

  return NextResponse.json({ ok: true, sync, summary });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
