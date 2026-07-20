import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { loadChatContextSettings } from "@/lib/chat/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingChatSettingsColumnHint } from "@/lib/supabase/errors";

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const settings = await loadChatContextSettings(admin, auth.identity.userId);
  return NextResponse.json({
    smart_context: settings.smartContext,
    deep_memory: settings.deepMemory,
    polytician: settings.polytician,
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const patch: Record<string, boolean> = {};
  if (body.smart_context !== undefined) {
    if (typeof body.smart_context !== "boolean") {
      return NextResponse.json({ error: "smart_context must be a boolean." }, { status: 400 });
    }
    patch.chat_smart_context = body.smart_context;
  }
  if (body.deep_memory !== undefined) {
    if (typeof body.deep_memory !== "boolean") {
      return NextResponse.json({ error: "deep_memory must be a boolean." }, { status: 400 });
    }
    patch.chat_deep_memory = body.deep_memory;
  }
  if (body.polytician !== undefined) {
    if (typeof body.polytician !== "boolean") {
      return NextResponse.json({ error: "polytician must be a boolean." }, { status: 400 });
    }
    patch.chat_polytician = body.polytician;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Nothing to change — send smart_context, deep_memory, and/or polytician." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const returning = "chat_polytician" in patch
    ? "chat_smart_context, chat_deep_memory, chat_polytician"
    : "chat_smart_context, chat_deep_memory";
  const { data: updated, error } = await admin
    .from("profiles")
    .update(patch)
    .eq("id", auth.identity.userId)
    .select(returning)
    .maybeSingle();

  if (error) {
    const hint = missingChatSettingsColumnHint(error);
    return NextResponse.json({ error: hint ?? error.message }, { status: hint ? 503 : 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "No profile found for this account." }, { status: 404 });
  }

  const row = updated as { chat_smart_context?: boolean; chat_deep_memory?: boolean; chat_polytician?: boolean };
  return NextResponse.json({
    smart_context: row.chat_smart_context !== false,
    deep_memory: row.chat_deep_memory !== false,
    polytician:
      "chat_polytician" in patch
        ? row.chat_polytician !== false
        : (await loadChatContextSettings(admin, auth.identity.userId)).polytician,
  });
}
