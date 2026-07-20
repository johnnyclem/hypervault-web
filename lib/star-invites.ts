import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, type SendEmailResult } from "@/lib/email";
import { fetchStargazers, fetchUserEmail, type Stargazer } from "@/lib/github";
import { generateInviteCode } from "@/lib/invites";
import { appUrl } from "@/lib/utils";


export type StargazerRow = {
  id: string;
  github_id: number;
  github_login: string;
  email: string | null;
  unsubscribed: boolean;
  invites_sent: number;
};

const INVITE_MAX_USES = 1;

function isEligible(row: Pick<StargazerRow, "email" | "unsubscribed">): boolean {
  return !row.unsubscribed && Boolean(row.email && row.email.includes("@"));
}

export function buildInviteEmail(code: string, login: string): {
  subject: string;
  html: string;
  text: string;
} {
  const redeemUrl = `${appUrl()}/login?invite=${encodeURIComponent(code)}`;
  const subject = "Your HyperVault invite code is here ⭐";
  const text = [
    `Hi @${login},`,
    "",
    "Thanks for starring HyperVault! Here's your invite code:",
    "",
    `    ${code}`,
    "",
    `Redeem it here: ${redeemUrl}`,
    "",
    "It unlocks your vault the moment you sign in with Google.",
    "",
    "— The HyperVault crew",
  ].join("\n");
  const html = `
  <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#0f172a;line-height:1.6">
    <p>Hi @${escapeHtml(login)},</p>
    <p>Thanks for starring <strong>HyperVault</strong> ⭐ — here's your invite code:</p>
    <p style="text-align:center;margin:24px 0">
      <span style="display:inline-block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;letter-spacing:2px;font-weight:700;padding:12px 20px;border-radius:12px;background:#0f172a;color:#f8fafc">${escapeHtml(code)}</span>
    </p>
    <p style="text-align:center;margin:24px 0">
      <a href="${escapeHtml(redeemUrl)}" style="display:inline-block;padding:12px 24px;border-radius:9999px;background:#6366f1;color:#fff;text-decoration:none;font-weight:600">Redeem your invite</a>
    </p>
    <p>It unlocks your vault the moment you sign in with Google.</p>
    <p style="color:#64748b;font-size:13px">— The HyperVault crew</p>
  </div>`;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type SyncResult = { fetched: number; upserted: number; error?: string };

export async function syncStargazers(admin: SupabaseClient): Promise<SyncResult> {
  let stargazers: Stargazer[];
  try {
    stargazers = await fetchStargazers();
  } catch (e) {
    return { fetched: 0, upserted: 0, error: e instanceof Error ? e.message : String(e) };
  }

  const { data: existing, error: readErr } = await admin
    .from("github_stargazers")
    .select("github_id");
  if (readErr) return { fetched: stargazers.length, upserted: 0, error: readErr.message };

  const known = new Set((existing ?? []).map((r: { github_id: number }) => r.github_id));
  const fresh = stargazers.filter((s) => !known.has(s.githubId));

  let upserted = 0;
  for (const s of fresh) {
    const email = await fetchUserEmail(s.login);
    const { error } = await admin.from("github_stargazers").upsert(
      {
        github_id: s.githubId,
        github_login: s.login,
        avatar_url: s.avatarUrl,
        email,
        ...(s.starredAt ? { starred_at: s.starredAt } : {}),
      },
      { onConflict: "github_id" }
    );
    if (!error) upserted += 1;
  }
  return { fetched: stargazers.length, upserted };
}

export type WeeklyInviteSummary = {
  eligible: number;
  sent: number;
  skipped: number;
  failures: Array<{ login: string; error: string }>;
};

export async function sendWeeklyInvites(admin: SupabaseClient): Promise<WeeklyInviteSummary> {
  const summary: WeeklyInviteSummary = { eligible: 0, sent: 0, skipped: 0, failures: [] };

  const { data: rows, error } = await admin
    .from("github_stargazers")
    .select("id, github_id, github_login, email, unsubscribed, invites_sent")
    .eq("unsubscribed", false);
  if (error) {
    summary.failures.push({ login: "*", error: error.message });
    return summary;
  }

  for (const row of (rows ?? []) as StargazerRow[]) {
    if (!isEligible(row)) {
      summary.skipped += 1;
      continue;
    }
    summary.eligible += 1;

    const code = generateInviteCode();
    const { data: invite, error: mintErr } = await admin
      .from("invite_codes")
      .insert({
        code,
        max_uses: INVITE_MAX_USES,
        note: `GitHub star weekly invite — @${row.github_login}`,
      })
      .select("id")
      .single();
    if (mintErr || !invite) {
      summary.failures.push({ login: row.github_login, error: mintErr?.message ?? "mint failed" });
      continue;
    }

    const { subject, html, text } = buildInviteEmail(code, row.github_login);
    let result: SendEmailResult;
    try {
      result = await sendEmail({ to: row.email!, subject, html, text });
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    if (!result.ok) {
      await admin.from("invite_codes").update({ disabled: true }).eq("id", invite.id);
      if (result.skipped) {
        summary.skipped += 1;
      } else {
        summary.failures.push({ login: row.github_login, error: result.error ?? "send failed" });
      }
      continue;
    }

    await admin
      .from("github_stargazers")
      .update({
        invites_sent: row.invites_sent + 1,
        last_invited_at: new Date().toISOString(),
        last_invite_code_id: invite.id,
      })
      .eq("id", row.id);
    summary.sent += 1;
  }

  return summary;
}
