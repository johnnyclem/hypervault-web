import { NextResponse, type NextRequest } from "next/server";
import { createClient, getUser } from "@/lib/supabase/server";
import { isMissingRedeemFunction } from "@/lib/invite-schema";
import { normalizeInviteCode } from "@/lib/invites";
import { rateLimit } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const limited = rateLimit(`invite:${user.id}`, 10, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many attempts — wait a minute." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? normalizeInviteCode(body.code) : "";
  if (!code) return NextResponse.json({ error: "Enter an invite code." }, { status: 400 });

  const supabase = (await createClient())!;
  const { data: result, error } = await supabase.rpc("redeem_invite_code", { p_code: code });
  if (error) {
    if (isMissingRedeemFunction(error)) {
      return NextResponse.json(
        { error: "Invite redemption isn't set up on this server yet — please try again later." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Could not redeem the code." }, { status: 500 });
  }

  const ok = result === "ok" || result === "already_approved";
  return NextResponse.json({ result }, { status: ok ? 200 : 400 });
}
