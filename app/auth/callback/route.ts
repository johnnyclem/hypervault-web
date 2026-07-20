import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { authCookieExpirations, hasVerifierCookie, parseCookieNames } from "@/lib/auth-cookies";
import { INVITE_COOKIE, isAdminEmail } from "@/lib/invites";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/vault";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/vault";

  const loginRedirect = (error: string, reason?: string) => {
    const url = new URL("/login", origin);
    url.searchParams.set("error", error);
    if (reason) url.searchParams.set("reason", reason);
    if (safeNext !== "/vault") url.searchParams.set("next", safeNext);
    const res = NextResponse.redirect(url);
    res.cookies.delete(INVITE_COOKIE);
    return res;
  };

  if (!code) {
    return loginRedirect("auth", searchParams.get("error") ? "provider" : "nocode");
  }

  const supabase = await createClient();
  if (!supabase) return loginRedirect("auth", "config");

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  const user = data?.user;
  if (error || !user) {
    const cookieHeader = request.headers.get("cookie");
    const verifierMissing =
      !hasVerifierCookie(parseCookieNames(cookieHeader)) || /verifier/i.test(error?.message ?? "");
    const res = loginRedirect("auth", verifierMissing ? "verifier" : "exchange");
    for (const header of authCookieExpirations(cookieHeader, request.headers.get("host"), {
      secure: origin.startsWith("https"),
    })) {
      res.headers.append("Set-Cookie", header);
    }
    return res;
  }

  const redirectTo = (path: string) => {
    const res = NextResponse.redirect(`${origin}${path}`);
    res.cookies.delete(INVITE_COOKIE);
    return res;
  };

  try {
    if (isAdminEmail(user.email)) {
      const admin = createAdminClient();
      if (admin) {
        await admin
          .from("account_access")
          .upsert({ user_id: user.id, source: "admin" }, { onConflict: "user_id", ignoreDuplicates: true });
      }
      return redirectTo(safeNext);
    }

    const checker: SupabaseClient = createAdminClient() ?? supabase;
    const checkAccess = () =>
      checker.from("account_access").select("user_id").eq("user_id", user.id).maybeSingle();
    let access = await checkAccess();
    if (access.error) access = await checkAccess();
    if (access.error) {
      console.error("auth/callback: account_access check failed", access.error);
      return loginRedirect("retry");
    }
    if (access.data) return redirectTo(safeNext);

    if (searchParams.get("intent") === "login") {
      await supabase.auth.signOut({ scope: "local" });
      return loginRedirect("no_account");
    }

    const rawCookie = request.cookies.get(INVITE_COOKIE)?.value;
    let inviteCode: string | undefined;
    try {
      inviteCode = rawCookie ? decodeURIComponent(rawCookie) : undefined;
    } catch {
      inviteCode = rawCookie;
    }
    if (inviteCode) {
      const { data: result, error: rpcError } = await supabase.rpc("redeem_invite_code", {
        p_code: inviteCode,
      });
      if (rpcError) {
        console.error("auth/callback: redeem_invite_code failed", rpcError);
        return loginRedirect("retry");
      }
      if (result === "ok" || result === "already_approved") return redirectTo(safeNext);
      await joinWaitlist(supabase, user);
      return redirectTo(`/waitlist?code=${encodeURIComponent(String(result ?? "invalid"))}`);
    }

    await joinWaitlist(supabase, user);
    return redirectTo("/waitlist");
  } catch (err) {
    console.error("auth/callback: post-exchange step threw", err);
    return loginRedirect("retry");
  }
}

async function joinWaitlist(supabase: SupabaseClient, user: User) {
  await supabase.from("waitlist").insert({ user_id: user.id, email: user.email });
}
