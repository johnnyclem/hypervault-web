# M16 — Cross-cutting

**Status:** Draft · **Epic:** M16 · **Depends:** M1 (builds on the SDK, cache, queue, theming, telemetry scaffolds); touches every feature epic

## Goal

The non-functional layer that makes the app store-ready across all features:
concrete per-feature offline read-cache + mutation-queue policy (ties to M1's
scaffolding, spec §7), deep links + universal links, push notifications (needs
a backend hook — flagged), an accessibility pass (screen reader, dynamic type,
44pt, reduced motion), theming polish, telemetry/analytics + crash reporting,
app-version-vs-`capabilities.api_version` soft-update prompt, and the sandboxed
WebView policy for rendering untrusted artifact HTML (spec §10). M1 built the
scaffolds; this epic makes each feature honor them and closes the polish gaps.

## User stories

- As a user, I can browse the vault, read conversations, memorize, and chat
  on-device fully offline; my writes queue and replay on reconnect.
- As a user, tapping a HyperVault link or a share URL opens the right screen in
  the app.
- As a user, I get a push when something needs me (a share, an approval, an
  agent saving to my vault).
- As a user relying on assistive tech, every control is labeled, respects my
  text size, and honors reduced motion.
- As a user, I'm prompted to update when my app is too old for the API, and
  untrusted artifact HTML can't touch my session.

## Tasks

| ID | Title | Pts | Depends | Description / Acceptance |
| --- | --- | --- | --- | --- |
| T-M16-01 | Per-feature offline read-cache policy | 2 | T-M1-09 | Concrete stale-while-revalidate policy per feature over M1's cache: vault artifact list, open conversations + messages, memory browse list, git-mind branches, capabilities (spec §7). Define TTL/revalidate-on-focus per key, per-user namespacing, and a subtle stale indicator. Acceptance: each listed screen paints instantly offline from cache, revalidates on reconnect/focus, shows staleness, and never leaks another user's cache after sign-out. |
| T-M16-02 | Per-feature mutation-queue policy | 2 | T-M1-10, T-M16-01 | Register each deferrable write against M1's queue with its idempotency handling: save artifact (`/api/save` content-hash dedupe), memorize (`/api/memories`), feedback (`/api/messages|artifacts/[…]/feedback`), visibility toggle, connect (idempotent). **Excluded:** memory merges — round-trip to `/api/mind/merge`, never queue (spec §7). On-device chat: reply generated offline, `/api/chat/turns` persist deferred (headline offline capability, coordinate with M9). Acceptance: each write applies optimistically offline, replays FIFO on reconnect, reconciles or rolls back with a toast; merges are never queued. |
| T-M16-03 | Deep-link + universal-link routing | 2 | T-M1-02, T-M2 | Wire the `hypervault://` scheme + universal links to routes, honoring web params: `?source_prompt=` (new-from-chat prefill, M3), `?open=` (open an item), `?branch=` (git-mind branch, M7), `?invite=1` (invite redeem, M2), `?next=` (post-auth redirect), artifact `/a/<slug>`, shared conversation `/c/<slug>`. Cold-start and warm-start both route; unauthed deep links pass through the auth gate then resume (`?next=`). Acceptance: each param/path opens the correct screen from cold and warm start; an unauthed deep link signs in then lands on the target. |
| T-M16-04 | Universal-link domain association (ops) | 1 | T-M16-03 | Ship `apple-app-site-association` + Android `assetlinks.json` associations for the canonical domain and register associated-domains / intent filters. **Flag — ops task:** hosting the association files on `hypervault.store` and adding the deep-link redirect allow-list entries is an ops dependency (parallels M2's Supabase redirect allow-list, spec §8/§13.3). Acceptance: a tapped `https://hypervault.store/a/<slug>` opens the app (not the browser) once the association files are live; the ops dependency is documented. |
| T-M16-05 | Push notifications + backend hook (flag) | 2 | T-M1-11, T-M2 | Register for push (Expo push / APNs + FCM), store the device token server-side, and handle notification taps → deep-link (T-M16-03). Events (spec §13.6): share received, invite approved, agent saved to your vault. **Flag — backend task:** there is no push-emit hook today — the backend must persist device tokens and emit on these events; document the token-registration endpoint + event triggers needed. Client handles receipt/permissions/tap-through now; wiring lights up when the backend hook lands. Acceptance: permission prompt + token registration work; a test push deep-links to the right screen; the missing backend emit hook is flagged with the required events. |
| T-M16-06 | Accessibility pass | 2 | T-M1-08 | Audit every screen: screen-reader labels + roles on all interactive controls, dynamic type (no clipping at large sizes), 44pt minimum touch targets, reduced-motion honored by the graph (M4) and all animation, sensible focus order, `aria-live`-equivalent announcements for async results (availability, imports, compiles). Acceptance: a screen-reader pass reaches and describes every control; text scales without breaking layout; reduced-motion disables non-essential animation including the graph sim. |
| T-M16-07 | Theming polish | 1 | T-M1-07, T-M13-08 | Finalize theme coverage across every screen in light/dark and each catalog theme: consistent tokens, no hard-coded colors, correct fallback for unknown/absent themes by `mode`, live repaint on dashboard-theme change (M13). Acceptance: switching OS light/dark and switching the dashboard theme restyles all screens with no orphaned colors; a theme gallery pass shows parity. |
| T-M16-08 | Telemetry / analytics + crash reporting | 2 | T-M1-11 | Wire a real sink behind M1's telemetry interface: screen views, API latency/error counts, key funnels (sign-in, save, chat turn, claim, compile), plus a crash reporter tied to the global error boundary (T-M1-12). Enforce redaction — never log tokens/keys or on-device prompt content (spec §10). Respect a user opt-out. Acceptance: events and crashes reach the sink with no secrets/prompt text; opt-out silences analytics; error boundary crashes are reported with stacks. |
| T-M16-09 | App-version vs api_version soft-update prompt | 1 | T-M1-04 | Compare the app's supported window against `capabilities.api_version`; beyond the window show a non-blocking "update available" prompt with a store link (spec §11). Never hard-block on a minor skew. Acceptance: a forced version mismatch shows the soft prompt; a supported version shows nothing; the prompt links to the store listing. |
| T-M16-10 | Sandboxed WebView policy for artifact HTML | 2 | T-M1-01 | Define and enforce the render policy for untrusted artifact HTML (and any HTML-bearing content): a sandboxed `react-native-webview` with no same-origin access to the app, no injected session/token, JS gated, external navigation intercepted/opened out, and a strict origin so artifact content can never reach the Bearer JWT or Supabase session (spec §10). Reuse for previewing saved artifacts (M3). Acceptance: artifact HTML renders in an isolated WebView that cannot read app storage or the session; links open externally; a hostile artifact can't exfiltrate the token. |

## Out of scope / notes

- **Backend dependencies flagged here:** push emit hook + device-token storage
  (T-M16-05); universal-link association hosting + allow-list (ops, T-M16-04).
  Both parallel other flagged deps (M2 redirect allow-list, M15 admin list
  endpoints).
- Streaming remains a backend gap (spec §11) — remote chat shows a determinate
  thinking state; on-device/WebLLM streams natively (M9). Not addressed here.
- This epic owns the *policy*; the scaffolding is M1. Each feature epic is
  responsible for registering its own cache keys and mutations against the M1
  primitives per T-M16-01/02.
