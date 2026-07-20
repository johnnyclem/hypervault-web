import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const feedback = body.feedback ?? null;
  if (feedback !== "up" && feedback !== "down" && feedback !== null) {
    return NextResponse.json({ error: 'feedback must be "up", "down", or null.' }, { status: 400 });
  }
  const value = feedback === "up" ? 1 : feedback === "down" ? -1 : null;

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data: message } = await admin
    .from("messages")
    .select("id, role")
    .eq("id", id)
    .eq("user_id", auth.identity.userId)
    .maybeSingle();
  if (!message) return NextResponse.json({ error: "Message not found." }, { status: 404 });
  if (message.role !== "assistant") {
    return NextResponse.json({ error: "Only assistant replies can be rated." }, { status: 400 });
  }

  const { error } = await admin.from("messages").update({ feedback: value }).eq("id", id);
  if (error) {
    if (/feedback/i.test(error.message) && /column|schema/i.test(error.message)) {
      return NextResponse.json(
        { error: "Feedback isn't enabled on this server yet — apply migration 0014_message_feedback." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    id,
    feedback,
    message:
      feedback === null
        ? "Rating cleared."
        : "Thanks — future replies will lean toward what you like.",
  });
}
