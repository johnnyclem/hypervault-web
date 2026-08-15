import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { parseExport } from "@/lib/imports";
import { rateLimit } from "@/lib/ratelimit";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const MAX_IMPORT_BYTES = 50_000_000;
const MESSAGE_BATCH = 500;

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // A single large export can legitimately arrive as ~15 sequential chunked
  // POSTs (see lib/imports/chunk.ts) — keep headroom above that.
  const limited = rateLimit(`chat-import:${auth.identity.userId}`, 30, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Import rate limit reached — try again in a minute." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const data = typeof body.data === "string" ? body.data : "";
  if (!data.trim()) {
    return NextResponse.json(
      { error: "data is required — the export file contents or a pasted transcript." },
      { status: 400 }
    );
  }
  if (new TextEncoder().encode(data).length > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      { error: "Import is over the 50 MB limit — split the export and import in parts." },
      { status: 413 }
    );
  }

  const platformHint = typeof body.platform === "string" ? body.platform : undefined;
  const title = typeof body.title === "string" ? body.title : undefined;

  const { platform, conversations } = parseExport(data, platformHint);
  if (conversations.length === 0) {
    return NextResponse.json(
      {
        error:
          "Couldn't find any conversations in that data. Upload the conversations.json from your platform's export, or paste a transcript with User:/Assistant: labels.",
      },
      { status: 400 }
    );
  }
  if (title && conversations.length === 1) conversations[0].title = title;

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const userId = auth.identity.userId;
  let imported = 0;
  let skipped = 0;
  let messageCount = 0;

  for (const convo of conversations) {
    if (convo.messages.length === 0) {
      skipped++;
      continue;
    }

    if (convo.externalId) {
      const { data: existing } = await admin
        .from("conversations")
        .select("id")
        .eq("user_id", userId)
        .eq("source_platform", convo.platform)
        .eq("external_id", convo.externalId)
        .maybeSingle();
      if (existing) await admin.from("conversations").delete().eq("id", existing.id);
    }

    const { data: inserted, error } = await admin
      .from("conversations")
      .insert({
        user_id: userId,
        title: convo.title.slice(0, 300),
        source_platform: convo.platform,
        external_id: convo.externalId ?? null,
        model: convo.model ?? null,
        created_at: convo.createdAt ?? new Date().toISOString(),
        updated_at: convo.updatedAt ?? convo.createdAt ?? new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error || !inserted) {
      skipped++;
      continue;
    }

    const rows = convo.messages.map((m, i) => ({
      conversation_id: inserted.id,
      user_id: userId,
      role: m.role,
      content: m.content,
      attachments: m.attachments,
      model: m.model ?? null,
      position: i,
      created_at: m.createdAt ?? new Date().toISOString(),
    }));
    for (let i = 0; i < rows.length; i += MESSAGE_BATCH) {
      const { error: msgError } = await admin.from("messages").insert(rows.slice(i, i + MESSAGE_BATCH));
      if (msgError) break;
    }
    imported++;
    messageCount += rows.length;
  }

  return NextResponse.json({
    platform,
    imported,
    skipped,
    messages: messageCount,
    message: `Imported ${imported} conversation${imported === 1 ? "" : "s"} (${messageCount} messages) from ${platform}. Open /chat to continue them on any backend.`,
  });
}
