# Google sign-in on vanity domains

HyperVault serves one app across many vanity domains (`claudedamnit.com`,
`vault.cool`, `{name}.vault.cool`, …). Google sign-in uses Supabase's PKCE
flow: the OAuth **code verifier** is stored in a host-scoped cookie when
sign-in starts, and the `/auth/callback` route exchanges it for a session **on
the same origin**. So sign-in starts *and* finishes on whichever host the user
is on — there is no cross-origin handoff.

For that to work, Supabase must accept a `redirect_to` back to each of those
hosts. If a host is missing from the project's **Redirect URLs** allow-list,
Supabase falls back to the Site URL after Google, the code lands on the wrong
origin where the verifier cookie isn't visible, the exchange fails, and sign-in
loops back to `/login?error=auth` ("Sign-in didn't complete — try again.").

## Required Supabase configuration

In the Supabase dashboard → **Authentication → URL Configuration**:

1. **Site URL** — set to the primary public origin (e.g.
   `https://www.claudedamnit.com`). This is only the fallback target; the
   allow-list below is what makes per-domain sign-in work.
2. **Redirect URLs** — add an apex entry **and** a wildcard-subdomain entry for
   every base domain. The `*` wildcard matches subdomains only, not the apex,
   so both lines are needed per domain:

   ```
   https://{base}/**
   https://*.{base}/**
   ```

Generate the full list (kept in sync with `lib/domains.ts` /
`NEXT_PUBLIC_VANITY_DOMAINS`) with:

```bash
node scripts/print-auth-redirect-urls.mjs
```

Paste its output into the Redirect URLs field. Re-run and update the list
whenever a base domain is added or removed.

## Google Cloud Console

No per-vanity-domain change is needed. Google only ever redirects to Supabase's
own callback (`https://<project-ref>.supabase.co/auth/v1/callback`), which must
be in the OAuth client's **Authorized redirect URIs** — Supabase manages this
when you configure the Google provider.

## `NEXT_PUBLIC_APP_URL`

Unrelated to which hosts can sign in — it only sets the canonical origin for OG
tags and generated artifact URLs. Sign-in always uses the current host, and the
private-artifact lock page offers login on the current base domain (falling
back to this origin only on unknown hosts like previews).

## Self-healing behaviors (why login can't wedge anymore)

The auth path assumes any single failure may be transient, and never converts
a transient failure into a signed-out or "no account" state:

- **Stale PKCE verifier / shadowed cookies.** A leftover
  `sb-*-code-verifier` (or the same session cookie present under two Domain
  scopes, host-only and `.{base}`) used to fail *every* exchange until the
  user manually cleared cookies. Now: the sign-in button sweeps stale
  verifier cookies in both scopes before starting OAuth, and a failed
  exchange in `/auth/callback` expires **all** Supabase auth cookies in both
  scopes on the way out — the next attempt always starts clean.
- **Refresh-token rotation races.** Parallel requests refreshing the same
  expired session can make one `getUser()` call fail spuriously.
  `lib/supabase/server.ts#getUser` retries once when a session cookie is
  present, middleware now refreshes sessions on `/a/` pages too, and the
  private-artifact lock page reloads itself once when the browser holds a
  session cookie the server couldn't resolve.
- **Database blips during the callback.** The `account_access` check runs on
  the service-role client (immune to RLS drift), retries once, and on
  persistent error redirects to `/login?error=retry` **without** signing the
  user out — it never reports "no account" unless the row is genuinely
  absent.
- **Destinations survive errors.** Every callback error redirect and the
  `/vault?repair=…` login bounce carry `next`, so a retry lands the user
  where they were headed, not on a bare dashboard.

## Diagnosing a login report

Ask the affected user (or open yourself, on the affected domain):

```
https://{host}/api/auth/health
```

It reports — names and flags only, never cookie values — the resolved base
domain, cookie scope, which Supabase cookies are present, **duplicate cookie
names** (the shadow-cookie fingerprint), verifier presence, whether the
session resolves server-side, and the exact Redirect URLs the Supabase
allow-list needs for that host. Failed sign-ins also land on
`/login?error=…&reason=…` with a machine-readable reason
(`verifier`, `exchange`, `provider`, `nocode`, `config`, `retry`) instead of
one blanket message.
