import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { parseVisibility, sharePath } from "@/lib/chat/visibility";
import { ensureMainBranch } from "@/lib/mind/branches";
import { recordCommit } from "@/lib/mind/commits";
import { makeSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const userId = auth.identity.userId;
  async function loadConversation(columns: string) {
    return admin!
      .from("conversations")
      .select(columns)
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
  }
  let { data: conversation, error: convoError } = await loadConversation(
    "id, title, source_platform, model, created_at, updated_at, visibility, share_slug"
  );
  if (convoError && /visibility|share_slug/i.test(convoError.message)) {
    ({ data: conversation } = await loadConversation(
      "id, title, source_platform, model, created_at, updated_at"
    ));
  }
  if (!conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  async function loadMessages(columns: string) {
    return admin!
      .from("messages")
      .select(columns)
      .eq("conversation_id", id)
      .order("position", { ascending: true });
  }
  let { data: messages, error } = await loadMessages(
    "id, role, content, attachments, model, position, created_at, feedback"
  );
  if (error && /feedback/i.test(error.message)) {
    ({ data: messages, error } = await loadMessages(
      "id, role, content, attachments, model, position, created_at"
    ));
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversation, messages: messages ?? [] });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const visibility = parseVisibility(body.visibility);
  if (!visibility) {
    return NextResponse.json(
      { error: "visibility must be one of: private, shared, public." },
      { status: 400 }
    );
  }

  const { id } = await params;
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data: conversation, error: loadError } = await admin
    .from("conversations")
    .select("id, title, visibility, share_slug")
    .eq("id", id)
    .eq("user_id", auth.identity.userId)
    .maybeSingle();
  if (loadError && /visibility|share_slug/i.test(loadError.message)) {
    return NextResponse.json(
      { error: "Chat sharing needs database migration 0016 — apply it first." },
      { status: 503 }
    );
  }
  if (!conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  const shareSlug =
    conversation.share_slug ?? (visibility !== "private" ? makeSlug(conversation.title) : null);

  const { data: updated, error } = await admin
    .from("conversations")
    .update({ visibility, share_slug: shareSlug })
    .eq("id", id)
    .eq("user_id", auth.identity.userId)
    .select("id, title, source_platform, model, created_at, updated_at, visibility, share_slug")
    .single();
  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? "Could not update the conversation." }, { status: 500 });
  }

  return NextResponse.json({
    conversation: updated,
    share_url: updated.visibility !== "private" && updated.share_slug ? sharePath(updated.share_slug) : null,
    message:
      updated.visibility === "private"
        ? "This chat is private again — the share link no longer works."
        : updated.visibility === "shared"
          ? "Anyone with the link can now read this chat."
          : "This chat is now public.",
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  let memoryId: string | null = null;
  const { data: convo, error: convoError } = await admin
    .from("conversations")
    .select("id, memory_id")
    .eq("id", id)
    .eq("user_id", auth.identity.userId)
    .maybeSingle();
  if (!convoError && convo) memoryId = (convo.memory_id as string | null) ?? null;

  const { error } = await admin
    .from("conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.identity.userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (memoryId) {
    try {
      const branch = await ensureMainBranch(admin, auth.identity.userId);
      await recordCommit(
        admin,
        auth.identity,
        branch.id,
        "chat deleted: remove its mirror memory",
        [{ memory_id: memoryId, op: "delete", title: "", content: "", summary: "", tags: [], source: "chat" }],
        [],
        { authorKind: "system" }
      );
    } catch {
    }
  }
  return NextResponse.json({ message: "Conversation deleted." });
}
