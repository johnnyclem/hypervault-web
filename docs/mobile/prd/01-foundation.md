# M1 — Foundation & App Shell

**Status:** Draft · **Epic:** M1 · **Depends:** — (first epic; blocks all others)

## Goal

Stand up the React Native + Expo (dev client) project and the shared plumbing
every other epic builds on: navigation skeleton, the typed HyperVault SDK
(Bearer injection, retry/backoff, error normalization), the capabilities
bootstrap, secure storage, the theming system, base UI primitives, and the
offline read-cache + mutation-queue scaffolding. Exit criteria: the app boots,
fetches `GET /api/capabilities`, applies a theme, and renders the empty
navigation shell with placeholder screens for M2–M16.

## User stories

- As an engineer, I can clone the repo and run an Expo dev client on iOS and
  Android with one command.
- As an engineer, I can call any HyperVault endpoint through one typed SDK that
  injects the Bearer token, retries transient failures, and surfaces
  `{ error }` verbatim.
- As the app, I can read one `GET /api/capabilities` response and configure my
  base URL, feature flags, limits, provider registry, and theme catalog.
- As a user, I see the app in my dashboard theme and in the system light/dark
  mode, with consistent buttons, cards, inputs, sheets, and toasts.
- As a user, previously loaded lists render instantly from cache and my writes
  survive a dropped connection.

## Tasks

| ID | Title | Pts | Depends | Description / Acceptance |
| --- | --- | --- | --- | --- |
| T-M1-01 | Bootstrap Expo project + dev client | 2 | — | Create the RN + Expo app configured as a **dev client** (not managed-only). Add config plugins for `expo-secure-store`, `react-native-webview`, and the `hypervault://` URL scheme + associated-domains entitlement (used by M2). TypeScript strict mode, ESLint/Prettier, EAS build profiles for dev/preview. Acceptance: `eas build --profile development` produces installable iOS + Android dev clients that launch to a placeholder screen. Native-native substitution noted in spec §3.2. |
| T-M1-02 | Navigation skeleton (tab + stack) for all epics | 2 | T-M1-01 | Root navigator with a bottom tab bar — Vault, Memory, Chat, Tools, Settings — and a stack per tab. Register placeholder routes for every epic screen referenced in M3–M16 (artifact detail, graph, memory detail, git-mind, conversation, backends, MCP, domains, admin) plus modal routes for sheets/confirms. Deep-link config object stubbed (M2/M16 fill URLs). Acceptance: every tab and placeholder route is reachable; back/stack behavior works; unauthenticated users are held by an auth-gate stub (M2 replaces it). |
| T-M1-03 | HyperVault SDK core (transport, Bearer, retry, errors) | 2 | T-M1-01 | Single typed REST client: base URL from capabilities `app_url` (reject non-HTTPS), `Authorization: Bearer <jwt>` injection via a pluggable token provider (M2 supplies it), `Content-Type: application/json`. Retry/backoff on network + `429`/`5xx` (exponential, jittered, capped, idempotent methods only). Error normalization: parse `{ error: string }` and throw a typed `ApiError { status, error, code? }` surfaced verbatim; `401` → single refresh hook callback then retry, else bubble to sign-in. Per-request `AbortSignal`. Acceptance: unit tests cover 200/400/401-refresh/429-retry/503 and malformed-JSON paths. |
| T-M1-04 | Capabilities client (bootstrap, cache, api_version check) | 2 | T-M1-03 | Fetch `GET /api/capabilities` (public; enriched `user` block when a token exists) on launch. Persist the response and expose a typed accessor for `app_url`, `auth`, `features`, `limits`, `providers`, `domains`, `themes`, `user`. Stale-while-revalidate from the read cache (T-M1-09) so cold start is instant offline. Compare `api_version` against the app's supported window; on mismatch beyond the window show a non-blocking "update available" prompt (spec §11). Feed `limits` to the shared client-side validators (index conventions). Acceptance: app configures base URL, flags, and theme catalog purely from this call; offline launch uses cached capabilities; version-skew prompt renders on a forced mismatch. |
| T-M1-05 | SDK type layer from api-contract | 2 | T-M1-03 | Handwritten TypeScript request/response types for every endpoint in `api-contract.md`, plus the canonical types (`CanonicalRole`, `CanonicalAttachment`, `CanonicalMessage`). Group by domain (vault, connections, sharing, memory, mind, chat, backends, tools, domains, keys, import, invites, admin, capabilities). Each SDK method is typed end-to-end; no `any` on the wire. Acceptance: a compile-time check exercises one call per endpoint group; adding a field to a type surfaces as a type error at the call site. Do not invent endpoints — mirror the contract exactly. |
| T-M1-06 | Secure storage wiring | 1 | T-M1-01 | Wrap `expo-secure-store` (Keychain/Keystore) behind a small typed KV interface for the Supabase session and any on-device secrets (M10). Namespacing + a `clearAll()` used on sign-out. Acceptance: values round-trip across app restarts; `clearAll()` wipes them; reads on a fresh install return null. |
| T-M1-07 | Theming system (capabilities.themes + light/dark + dashboard theme) | 2 | T-M1-04 | Theme provider that consumes `capabilities.themes` (id/name/mode), the OS light/dark setting, and the user's dashboard theme (`capabilities.user` / `profiles.theme`; changed via `PATCH /api/dashboard-theme` in M13). Expose typed design tokens (color, spacing, radius, type scale) to all primitives. Honor reduced-motion. Acceptance: switching OS light/dark and switching the user's theme both restyle the whole app live; unknown/absent theme falls back to a default per its `mode`. |
| T-M1-08 | Base UI primitives | 2 | T-M1-07 | Themed, accessible primitives: Button, Card, Input, Drawer, BottomSheet, SegmentedControl, Toast (non-blocking error/status host wired to `ApiError`), and Confirm (native Alert/action sheet for destructive intent per spec §9). All honor active theme + light/dark, dynamic type, 44pt targets, and screen-reader labels. Acceptance: a primitives gallery screen renders each in light/dark and two themes; Toast shows an `ApiError.error` string verbatim; Confirm resolves a promise for destructive flows reused across M3–M15. |
| T-M1-09 | Offline read-cache scaffolding | 2 | T-M1-03 | Persistent stale-while-revalidate cache keyed **per user** (namespaced by `user.id`), cleared on sign-out. Provide a `useCachedQuery` hook that returns cached data instantly then revalidates. Seed the keys spec §7 names — vault list, open conversations, memory browse list, branches, capabilities. Acceptance: a screen shows cached content offline, revalidates on reconnect, and shows a subtle stale indicator; switching users does not leak the previous user's cache. |
| T-M1-10 | Mutation queue scaffolding | 2 | T-M1-09 | Offline mutation queue for deferrable writes (save artifact, memorize, feedback, visibility toggle, connect per spec §7): enqueue when offline with optimistic UI + rollback on failure, replay FIFO on reconnect, respect idempotency (`/api/save` content-hash dedupe, `/api/import` external-id dedupe, idempotent connect). Do not queue conflict-prone memory merges — round-trip to the server. Acceptance: a queued save appears optimistically offline, persists across restart, replays and reconciles on reconnect, and rolls back on a terminal error with a toast. Feature epics register their own mutations against this. |
| T-M1-11 | Telemetry & logging scaffold | 1 | T-M1-01 | Structured logger (levels, redaction of tokens/keys) and a thin telemetry interface (screen views, API latency, error counts) with a no-op default sink so events are emitted without a vendor chosen. Never log secrets or on-device prompt content. Acceptance: SDK requests emit timing + error events through the interface; logs redact `Authorization`/`X-HyperVault-Key`/session material. |
| T-M1-12 | Global error boundary | 1 | T-M1-08 | Root React error boundary that catches render errors, shows a themed recover screen (reload/report), and routes to the logger (T-M1-11). Distinguish handled `ApiError` (toast/inline) from unhandled crashes (boundary). Acceptance: a thrown render error shows the recover screen instead of a white screen and logs the stack; recovering re-mounts the navigator. |

## Out of scope / notes

- Auth (Supabase client, OAuth, invite gate) is **M2** — T-M1-03's token
  provider and T-M1-11's redaction are the seams M2 plugs into.
- `middleware.ts` host routing (vanity subdomains, cookie sessions) is **web-only
  and N/A on mobile** — the app always targets the canonical `app_url` from
  capabilities and never does host-based routing (spec §8).
- Streaming is a known backend gap (spec §11); the SDK's non-streaming shape is
  correct for now. On-device/WebLLM streaming lives in M9, not the SDK.
- Inference layer (`ChatModel`) and the WebLLM webview are **M9**, not M1.
