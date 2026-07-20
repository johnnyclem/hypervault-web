import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingDreamingSchemaHint } from "@/lib/supabase/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data } = await admin
    .from("profiles")
    .select("dreaming_enabled, dreaming_last_run_at")
    .eq("id", auth.identity.userId)
    .maybeSingle();

  return NextResponse.json({
    enabled: data?.dreaming_enabled ?? false,
    last_run_at: data?.dreaming_last_run_at ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data, error } = await admin
    .from("profiles")
    .update({ dreaming_enabled: body.enabled })
    .eq("id", auth.identity.userId)
    .select("dreaming_enabled, dreaming_last_run_at")
    .maybeSingle();

  if (error) {
    const hint = missingDreamingSchemaHint(error);
    return NextResponse.json({ error: hint ?? error.message }, { status: hint ? 503 : 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "No profile found for this account." }, { status: 404 });
  }

  return NextResponse.json({ enabled: data.dreaming_enabled, last_run_at: data.dreaming_last_run_at ?? null });
}
