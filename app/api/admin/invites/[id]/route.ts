import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/access";
import { INVITE_MIGRATION_HINT, isMissingInviteTable } from "@/lib/invite-schema";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (typeof body?.disabled !== "boolean") {
    return NextResponse.json({ error: "Pass { disabled: boolean }." }, { status: 400 });
  }

  const { data, error } = await guard.admin
    .from("invite_codes")
    .update({ disabled: body.disabled })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) {
    if (isMissingInviteTable(error)) {
      return NextResponse.json({ error: INVITE_MIGRATION_HINT }, { status: 503 });
    }
    return NextResponse.json({ error: `Update failed: ${error.message}` }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "No such invite code." }, { status: 404 });
  return NextResponse.json({ invite: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const { error } = await guard.admin.from("invite_codes").delete().eq("id", id);
  if (error) {
    if (isMissingInviteTable(error)) {
      return NextResponse.json({ error: INVITE_MIGRATION_HINT }, { status: 503 });
    }
    return NextResponse.json({ error: `Delete failed: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
