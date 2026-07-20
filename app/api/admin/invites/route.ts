import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/access";
import { INVITE_MIGRATION_HINT, isMissingInviteTable } from "@/lib/invite-schema";
import { generateInviteCode } from "@/lib/invites";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const maxUses = Math.min(Math.max(Math.trunc(Number(body?.maxUses) || 1), 1), 10_000);
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 200) : null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await guard.admin
      .from("invite_codes")
      .insert({ code: generateInviteCode(), max_uses: maxUses, note, created_by: guard.user.id })
      .select()
      .single();
    if (!error) return NextResponse.json({ invite: data });
    if (error.code !== "23505") {
      if (isMissingInviteTable(error)) {
        return NextResponse.json({ error: INVITE_MIGRATION_HINT }, { status: 503 });
      }
      return NextResponse.json(
        { error: `Could not create the invite code: ${error.message}` },
        { status: 500 }
      );
    }
  }
  return NextResponse.json({ error: "Could not create the invite code." }, { status: 500 });
}
