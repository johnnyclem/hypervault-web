import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const userId = auth.identity.userId;
  async function loadConversations(columns: string) {
    return admin!
      .from("conversations")
      .select(columns)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(500);
  }
  let { data, error } = await loadConversations(
    "id, title, source_platform, model, created_at, updated_at, visibility, share_slug"
  );
  if (error && /visibility|share_slug/i.test(error.message)) {
    ({ data, error } = await loadConversations("id, title, source_platform, model, created_at, updated_at"));
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversations: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
  }
  const title = (typeof body.title === "string" && body.title.trim()) || "New conversation";

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data, error } = await admin
    .from("conversations")
    .insert({ user_id: auth.identity.userId, title, source_platform: "hypervault" })
    .select("id, title, source_platform, created_at, updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Could not create the conversation." }, { status: 500 });
  }
  return NextResponse.json({ conversation: data });
}
