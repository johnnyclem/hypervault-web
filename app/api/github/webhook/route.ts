import { NextResponse, type NextRequest } from "next/server";
import { fetchUserEmail, verifyWebhookSignature } from "@/lib/github";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  }

  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyWebhookSignature(raw, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const event = req.headers.get("x-github-event");
  if (event === "ping") return NextResponse.json({ ok: true, pong: true });
  if (event !== "star") return NextResponse.json({ ok: true, ignored: event });

  let payload: {
    action?: string;
    starred_at?: string | null;
    sender?: { id?: number; login?: string; avatar_url?: string };
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  const sender = payload.sender;
  if (!sender?.id || !sender.login) {
    return NextResponse.json({ error: "Missing sender." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  }

  if (payload.action === "deleted") {
    const { error } = await admin
      .from("github_stargazers")
      .update({ unsubscribed: true })
      .eq("github_id", sender.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: "unsubscribed", login: sender.login });
  }

  const email = await fetchUserEmail(sender.login);
  const { error } = await admin.from("github_stargazers").upsert(
    {
      github_id: sender.id,
      github_login: sender.login,
      avatar_url: sender.avatar_url ?? null,
      unsubscribed: false,
      ...(email ? { email } : {}),
      ...(payload.starred_at ? { starred_at: payload.starred_at } : {}),
    },
    { onConflict: "github_id" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, action: "subscribed", login: sender.login });
}
