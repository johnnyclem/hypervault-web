import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingDigestionSchemaHint } from "@/lib/supabase/errors";

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
    .select("digestion_enabled")
    .eq("id", auth.identity.userId)
    .maybeSingle();

  return NextResponse.json({ enabled: data?.digestion_enabled ?? false });
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
    .update({ digestion_enabled: body.enabled })
    .eq("id", auth.identity.userId)
    .select("digestion_enabled")
    .maybeSingle();

  if (error) {
    const hint = missingDigestionSchemaHint(error);
    return NextResponse.json({ error: hint ?? error.message }, { status: hint ? 503 : 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "No profile found for this account." }, { status: 404 });
  }

  return NextResponse.json({ enabled: data.digestion_enabled });
}
