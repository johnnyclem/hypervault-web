import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/access";
import { INVITE_MIGRATION_HINT, isMissingInviteTable } from "@/lib/invite-schema";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const { error } = await guard.admin.from("waitlist").delete().eq("user_id", id);
  if (error) {
    if (isMissingInviteTable(error)) {
      return NextResponse.json({ error: INVITE_MIGRATION_HINT }, { status: 503 });
    }
    return NextResponse.json({ error: `Delete failed: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
