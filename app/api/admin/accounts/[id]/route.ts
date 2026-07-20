import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/access";
import { INVITE_MIGRATION_HINT, isMissingInviteTable } from "@/lib/invite-schema";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const profileUpdates: Record<string, string> = {};
  if (body?.plan !== undefined) {
    if (body.plan !== "free" && body.plan !== "pro") {
      return NextResponse.json({ error: "plan must be 'free' or 'pro'." }, { status: 400 });
    }
    profileUpdates.plan = body.plan;
  }
  if (body?.displayName !== undefined) {
    if (typeof body.displayName !== "string" || !body.displayName.trim()) {
      return NextResponse.json({ error: "displayName must be a non-empty string." }, { status: 400 });
    }
    profileUpdates.display_name = body.displayName.trim().slice(0, 80);
  }

  if (Object.keys(profileUpdates).length > 0) {
    const { error } = await guard.admin.from("profiles").update(profileUpdates).eq("id", id);
    if (error) return NextResponse.json({ error: "Profile update failed." }, { status: 500 });
  }

  if (typeof body?.approved === "boolean") {
    if (body.approved) {
      const { error } = await guard.admin
        .from("account_access")
        .upsert({ user_id: id, source: "admin" }, { onConflict: "user_id", ignoreDuplicates: true });
      if (error) {
        if (isMissingInviteTable(error)) {
          return NextResponse.json({ error: INVITE_MIGRATION_HINT }, { status: 503 });
        }
        return NextResponse.json({ error: `Could not grant access: ${error.message}` }, { status: 500 });
      }
      await guard.admin.from("waitlist").delete().eq("user_id", id);
    } else {
      if (id === guard.user.id) {
        return NextResponse.json({ error: "You can't revoke your own access." }, { status: 400 });
      }
      const { error } = await guard.admin.from("account_access").delete().eq("user_id", id);
      if (error) {
        if (isMissingInviteTable(error)) {
          return NextResponse.json({ error: INVITE_MIGRATION_HINT }, { status: 503 });
        }
        return NextResponse.json({ error: `Could not revoke access: ${error.message}` }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  if (id === guard.user.id) {
    return NextResponse.json({ error: "You can't delete your own admin account here." }, { status: 400 });
  }

  const { error } = await guard.admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: "Delete failed." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
