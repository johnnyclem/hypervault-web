# M2 — Authentication & Onboarding

**Status:** Draft · **Epic:** M2 · **Depends:** M1

## Goal

Let a user sign in with Google on device, hold a Supabase JWT in secure storage
with silent refresh, pass the invite/waitlist gate, and land in their vault —
or on a waitlist/redeem screen if not yet approved. The device holds a JWT (not
an SSR cookie), so every API call authenticates via `Authorization: Bearer`
through the M1 SDK. Exit criteria (spec §12, Phase 0): sign in, resolve the
invite gate, and land in an empty vault.

## User stories

- As a new user, I can sign in with Google without typing a password and stay
  signed in across app restarts.
- As a returning user, my session refreshes silently and I go straight to my
  vault.
- As a waitlisted user, I see a waitlist screen and can redeem an invite code to
  unlock my vault immediately.
- As an admin, I bypass the invite gate automatically.
- As any user, I can sign out and have all local session state wiped.
- As a user who taps an invite or share deep link, the app opens the right
  screen (`?invite=1`, `?next=`, `?error=`).

## Tasks

| ID | Title | Pts | Depends | Description / Acceptance |
| --- | --- | --- | --- | --- |
| T-M2-01 | Supabase device client (PKCE + secure-store session) | 2 | T-M1-04, T-M1-06 | Instantiate `@supabase/supabase-js` with `supabase_url`/`supabase_anon_key` from `capabilities.auth`, `flowType: 'pkce'`, `detectSessionInUrl: false`, `autoRefreshToken: true`, `persistSession: true`, and a **secure-store storage adapter** (T-M1-06 wrapping `expo-secure-store`). Anon key is public by design (spec §10). Acceptance: client initializes from capabilities; a manually seeded session persists across restart in the Keychain/Keystore, not AsyncStorage. |
| T-M2-02 | OPS — add mobile redirect to Supabase allow-list | 1 | — | **Blocking · external ops task.** Add `hypervault://auth/callback` (and the `https://hypervault.store/auth/mobile` universal-link variant) to the Supabase Auth **redirect allow-list** and configure Google OAuth for the native app. Blocks T-M2-03 end-to-end (spec §8, open question #3). Acceptance: both redirect URLs appear in the project's allow-list; a test OAuth round-trip returns to the app scheme instead of falling back to the web Site URL. Owner to be assigned. |
| T-M2-03 | Google OAuth via deep link | 2 | T-M2-01, T-M2-02 | `signInWithOAuth({ provider: 'google', options: { redirectTo: 'hypervault://auth/callback', skipBrowserRedirect: true } })`, open the returned URL in `ASWebAuthenticationSession` (iOS) / Chrome Custom Tab (Android), catch the `hypervault://auth/callback?code=…` deep link, and call `exchangeCodeForSession(code)`. No cookies, no host routing — always the canonical `app_url` (spec §8). Acceptance: tapping "Continue with Google" completes the round-trip and yields a session; user cancel and `?error=` are handled with a themed message; failure loops back to the sign-in screen. |
| T-M2-04 | Session store + auto-refresh + SDK token provider | 2 | T-M2-01, T-M1-03 | Auth store exposing `session`, `user`, and `status`. Wire `autoRefreshToken` + `onAuthStateChange` to persist tokens to secure storage and feed the **current access token into the M1 SDK token provider**; implement the SDK's `401 → refresh once → retry, else sign out` hook. Foreground app-state listener triggers refresh when a token is near expiry. Acceptance: the SDK attaches a valid Bearer on every call; an expired token transparently refreshes on the next request; a hard-expired refresh token routes to sign-in. |
| T-M2-05 | Sign-out | 1 | T-M2-04, T-M1-09 | Sign out: `supabase.auth.signOut()`, secure-store `clearAll()` (T-M1-06), clear the per-user read cache + mutation queue (T-M1-09/10), reset navigation to the sign-in screen. Acceptance: after sign-out no session or user-scoped cache remains; a subsequent launch shows sign-in; a pending queued mutation for that user is discarded. |
| T-M2-06 | Invite-gate resolver | 1 | T-M2-04 | After sign-in, resolve access: admins bypass (email match, mirroring `isAdminEmail`); otherwise read the `account_access` row for `user.id` — prefer direct Supabase (RLS-scoped, contract §"Direct Supabase") or the enriched `capabilities.user` block. Expose `gate: 'approved' | 'waitlisted' | 'admin'`. Note the server enforces the same gate (403 waitlisted) regardless. Acceptance: an approved user resolves `approved`, a user with no `account_access` row resolves `waitlisted`, an admin resolves `admin`; result drives T-M2-11 routing. |
| T-M2-07 | Waitlist + invite-redeem screen | 2 | T-M2-06 | Screen for waitlisted users: explain the waitlist and offer an invite-code field (`HV-XXXX-XXXX`, normalized/uppercased, mirroring web `InviteRedeemForm`). Redeem via `rpc('redeem_invite_code', { p_code })` or `POST /api/invite/redeem` (once bearer-capable — T-M2-09); on `ok`/`already_approved` re-resolve the gate and route to vault. Surface redeem result codes as friendly messages; respect the 10/min limit. Acceptance: a valid code unlocks and lands in vault; an invalid/expired code shows the mapped message inline; rate-limit `429` shows verbatim. |
| T-M2-08 | Native Google Sign-In (id-token) — fast-follow | 2 | T-M2-04 | Add native Google Sign-In → `signInWithIdToken({ provider: 'google', token })` as the preferred path (no deep-link round-trip, best UX per spec §8). Config plugin + iOS/Android client IDs. Fall back to the T-M2-03 deep-link flow when native sign-in is unavailable. Acceptance: native sheet returns an id token that yields a Supabase session equivalent to the deep-link path; both paths converge on the same auth store. Ship after T-M2-03. |
| T-M2-09 | Backend — accept Bearer on `/api/keys` + `/api/invite/redeem` | 2 | — | **Small Next.js backend change.** Both routes currently call `getUser()` directly (session cookie only), so a bearer-only mobile client can't mint keys or redeem invites. Change them to resolve identity via a **session-or-bearer** path — reuse `resolveApiIdentity` (or a thin wrapper) **restricted to `via ∈ {session, bearer}`, explicitly NOT `api-key`**, to prevent an API key from minting more keys or self-approving (key-minting-keys / gate-bypass escalation). Keep existing rate limits (`keys` 5/min, `invite` 10/min) keyed on the resolved `userId`, and `/api/keys` stays a single-writer using the admin client. Update `api-contract.md` §"session/bearer-only" note + spec §4.1 once shipped. Acceptance: a bearer call to `POST /api/keys` mints a key and `POST /api/invite/redeem` redeems; an `X-HyperVault-Key` call to either route is rejected `401/403`; session calls unchanged. |
| T-M2-10 | Deep-link routing (`?invite=1` / `?next=` / `?error=`) | 2 | T-M2-03, T-M1-02 | Register the `hypervault://` scheme + universal links and parse auth-related params, mirroring web `/login`: `?invite=1` opens the redeem field pre-expanded; `?next=<same-origin path>` is the post-auth destination (validate it starts with `/` and not `//`); `?error=auth|no_account` shows the mapped message. Route the OAuth callback link into T-M2-03's exchange. Acceptance: cold and warm deep links resolve to the correct screen; `next` is honored after sign-in and rejected if not a safe same-origin path; unknown params are ignored. |
| T-M2-11 | Auth gate / routing guard | 2 | T-M2-04, T-M2-06 | Replace the M1 auth-gate stub: unauthenticated → sign-in; authenticated + `waitlisted` → waitlist screen (T-M2-07); authenticated + `approved`/`admin` → the tab shell landing in an empty vault. React to `onAuthStateChange` and gate re-resolution (e.g. after redeem) live. Acceptance: each of the three states lands on the correct screen without a manual reload; redeeming or signing out transitions immediately; matches Phase 0 exit ("sign in, land in an empty vault"). |

## Out of scope / notes

- **No cookies, no vanity-host routing on device** — `middleware.ts` behavior is
  web-only; the app always targets the canonical `app_url` (spec §8).
- Ship **deep-link OAuth (T-M2-03) first, native id-token (T-M2-08) as a
  fast-follow** — both converge on the same session store.
- **T-M2-02 (ops) and T-M2-09 (backend) are the two external blockers** for a
  fully bearer-native onboarding; T-M2-07 can fall back to the Supabase RPC
  until T-M2-09 lands.
- API-key minting UI (surfacing `POST/DELETE /api/keys` to power users) is a
  later epic; T-M2-09 only unblocks the route for bearer callers.
- Admin email list is server-owned (`isAdminEmail`); the client treats the
  gate result as advisory — the server re-checks on every request.
