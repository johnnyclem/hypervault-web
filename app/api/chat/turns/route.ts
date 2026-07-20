import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { syncConversationMemory } from "@/lib/chat/memory-sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { appendTranscript } from "@/lib/stenographer/log";

export const maxDuration = 60;

const MAX_MESSAGE_CHARS = 100_000;
const MAX_REPLY_CHARS = 400_000;

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const userMessage = typeof body.user_message === "string" ? body.user_message : "";
  const assistantContent = typeof body.assistant_content === "string" ? body.assistant_content : "";
  const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : "";
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : "on-device";
  const titleHint = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "";

  if (!userMessage.trim()) return NextResponse.json({ error: "user_message is required." }, { status: 400 });
  if (!assistantContent.trim()) {
    return NextResponse.json({ error: "assistant_content is required." }, { status: 400 });
  }
  if (userMessage.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: "user_message is too long." }, { status: 413 });
  }
  if (assistantContent.length > MAX_REPLY_CHARS) {
    return NextResponse.json({ error: "assistant_content is too long." }, { status: 413 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }
  const userId = auth.identity.userId;

  let convoId = conversationId;
  let convoTitle = titleHint || userMessage.slice(0, 80);
  let convoMemoryId: string | null = null;
  let memorySyncAvailable = true;

  if (convoId) {
    let { data: convo, error: convoError } = await admin
      .from("conversations")
      .select("id, title, memory_id")
      .eq("id", convoId)
      .eq("user_id", userId)
      .maybeSingle();
    if (convoError && /memory_id/i.test(convoError.message)) {
      memorySyncAvailable = false;
      ({ data: convo } = await admin
        .from("conversations")
        .select("id, title")
        .eq("id", convoId)
        .eq("user_id", userId)
        .maybeSingle());
    }
    if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    convoTitle = convo.title;
    convoMemoryId = "memory_id" in convo ? ((convo.memory_id as string | null) ?? null) : null;
  } else {
    const { data: created, error } = await admin
      .from("conversations")
      .insert({
        user_id: userId,
        title: convoTitle,
        source_platform: "hypervault",
        model,
      })
      .select("id")
      .single();
    if (error || !created) {
      return NextResponse.json({ error: "Could not create the conversation." }, { status: 500 });
    }
    convoId = created.id;
  }

  const { data: last } = await admin
    .from("messages")
    .select("position")
    .eq("conversation_id", convoId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = last ? last.position + 1 : 0;

  const rows = [
    { conversation_id: convoId, user_id: userId, role: "user", content: userMessage },
    { conversation_id: convoId, user_id: userId, role: "assistant", content: assistantContent, model },
  ].map((row, i) => ({ ...row, position: nextPosition + i }));

  const { data: saved, error: insertError } = await admin
    .from("messages")
    .insert(rows)
    .select("id, role, position");
  if (insertError) {
    return NextResponse.json({ error: `Could not save the turn: ${insertError.message}` }, { status: 500 });
  }
  const assistantMessageId =
    (saved ?? []).filter((m) => m.role === "assistant").sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).pop()
      ?.id ?? null;

  void appendTranscript(convoId, [
    { role: "user", content: userMessage },
    { role: "assistant", content: assistantContent },
  ]);

  await admin
    .from("conversations")
    .update({ updated_at: new Date().toISOString(), model })
    .eq("id", convoId);

  if (memorySyncAvailable) {
    try {
      const { data: allMessages } = await admin
        .from("messages")
        .select("role, content")
        .eq("conversation_id", convoId)
        .order("position", { ascending: true });
      const turns = (allMessages ?? [])
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as string, content: m.content as string }));
      await syncConversationMemory(
        admin,
        auth.identity,
        { id: convoId, title: convoTitle, memoryId: convoMemoryId },
        turns
      );
    } catch {
    }
  }

  return NextResponse.json({
    conversation_id: convoId,
    reply: {
      id: assistantMessageId,
      role: "assistant",
      content: assistantContent,
      model,
    },
  });
}
