# GitHub star → weekly invite codes

A growth loop: anyone who stars the HyperVault repo joins a list, and every
Monday each person on it is emailed a fresh single-use invite code that unlocks
their vault. The whole feature is gated behind env vars — leave them unset and
nothing is minted or sent.

## How it works

```
star the repo ─┐                       ┌─ mint invite_codes row (single-use)
               ├─ github_stargazers ──▶ ┤
GitHub API sync┘   (Supabase table)     └─ email the code (Resend)  ──▶ /login?invite=CODE
```

1. **Ingest.** Two paths keep `github_stargazers` current:
   - **Webhook (real-time):** `POST /api/github/webhook` receives GitHub `star`
     events, verifies `X-Hub-Signature-256`, and upserts the sender. An unstar
     (`action: deleted`) marks the row `unsubscribed` (history is kept).
   - **API sync (reconcile/backfill):** the weekly cron first calls the GitHub
     stargazers API and inserts anyone missing — so the list is complete even
     if the webhook was added late or missed a delivery.
   For each new stargazer we do a best-effort lookup of their **public** GitHub
   email. When GitHub hides it, the row has no email and is skipped at send time.

2. **Send.** `POST /api/cron/star-invites` (scheduled Monday via `vercel.json`)
   mints a fresh single-use code in the existing `invite_codes` table for every
   eligible stargazer (`note: "GitHub star weekly invite — @login"`) and emails
   it. If email can't be delivered, the minted code is disabled so it can't
   leak. The counter on the stargazer row only advances on a successful send.

3. **Redeem.** The email links to `/login?invite=HV-XXXX-XXXX`, which opens the
   invite field pre-filled. Redemption goes through the existing
   `redeem_invite_code()` RPC after Google sign-in.

## Setup

1. **Migrate:** `supabase db push` (adds `supabase/migrations/0021_github_star_invites.sql`).
2. **Env** (see `.env.example`): `GITHUB_WEBHOOK_SECRET`, `CRON_SECRET`,
   `RESEND_API_KEY`, `INVITE_FROM_EMAIL`, and optionally `GITHUB_TOKEN` /
   `GITHUB_STAR_REPO`.
3. **Webhook:** repo **Settings → Webhooks → Add webhook**
   - Payload URL: `https://<your-app>/api/github/webhook`
   - Content type: `application/json`
   - Secret: same value as `GITHUB_WEBHOOK_SECRET`
   - Events: **Let me select individual events → Stars**
4. **Cron:** `vercel.json` already schedules `/api/cron/star-invites` for
   Mondays at 15:00 UTC. Vercel Cron authenticates with `CRON_SECRET`
   automatically. Not on Vercel? Hit the route from any scheduler:
   ```
   curl -X POST https://<your-app>/api/cron/star-invites \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

## Operating notes

- **Email addresses.** We can only email stargazers whose GitHub public email
  is set; others are tracked but skipped. The `/admin` page shows how many of
  the tracked stargazers are reachable.
- **Manual run.** Trigger a send any time with the `curl` above — safe to
  re-run (each run mints new single-use codes).
- **Opt-out.** Unstarring marks a row `unsubscribed`; it's excluded from future
  sends but kept for history.
- **Email provider.** Only Resend is wired up (`lib/email.ts`, a dependency-free
  REST call). Swap providers by editing `sendEmail()`.
