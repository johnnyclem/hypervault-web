# HyperVault Mobile — Engineering Specification

**Status:** Draft for implementation handoff
**Owner:** Platform
**Last updated:** 2026-07-15
**Audience:** The engineer/agent building the native mobile client.

> This is the anchor document. It describes *what we're building and how the
> pieces fit*. The per-epic PRDs under [`docs/mobile/prd/`](./prd/) break the
> work into 1–2 story-point tasks with acceptance criteria. Read this first,
> then work the PRDs in dependency order (see
> [`prd/00-index.md`](./prd/00-index.md)).

---

## 1. Goal

Ship a **native mobile client** (iOS + Android) that exposes **100% of what
HyperVault can do** — every feature on the website, everything reachable
through the HyperVault REST API, and the tool surface of the HyperVault MCP —
with two additions that only make sense on a phone:

1. **On-device / in-browser inference by default.** Chat should run on an
   on-device foundation model (Apple Intelligence Foundation Models on iOS,
   Gemini Nano / AICore on Android) or a bundled WebLLM runtime when the
   platform model is unavailable — so the common case is private, offline-
   capable, and free of API keys.
2. **Power-user "bring your own LLM."** A user can point chat at any backend
   HyperVault already supports (OpenAI, Anthropic, xAI, Gemini, Mistral,
   Ollama, LM Studio, or a custom OpenAI-/Anthropic-compatible endpoint), and
   switch mid-conversation with zero context loss — exactly like the web app.

The mobile app is an **API client**, not a fork of the web app. All state lives
in the same Supabase-backed HyperVault backend; the phone is another head on
the same body. The vault, memory wiki, git-mind history, conversations, and
domain claims are identical whether touched from web, agent (MCP), or phone.

---

## 2. What "every feature" means (parity scope)

The feature surface was inventoried directly from source. The mobile app must
cover all of it. Grouped by epic (→ PRD):

| Area | Web surface | PRD |
| --- | --- | --- |
| Auth / onboarding | Google OAuth (Supabase PKCE), invite-code redeem, waitlist gate | [M2](./prd/02-auth-onboarding.md) |
| Vault — artifacts | list/graph, save "New from chat", JSX auto-wrap, view-source, visibility toggle, delete, install (A2HS), copy-link (multi-realm), source-prompt | [M3](./prd/03-vault-artifacts.md) |
| Vault graph | force-directed artifact+memory graph, node/edge styles, tap-to-open | [M4](./prd/04-vault-graph.md) |
| Connections & sharing | connect items, invite users to an artifact, "shared with you", leave | [M5](./prd/05-connections-sharing.md) |
| Memory wiki (Imaging V2) | Search / Ask / Graph, Memorize, import file/URL, edit, forget, provenance, ⌘K | [M6](./prd/06-memory-wiki.md) |
| Git-for-a-Mind (PRD 8) | branches, merge + conflict resolution, diff, history, revert, time-travel | [M7](./prd/07-git-mind.md) |
| Chat — server backends | thread UI, composer, recall/smart-context/deep-memory/tools toggles, per-turn actions, share/visibility | [M8](./prd/08-chat-core.md) |
| On-device / WebLLM inference | on-device model runtime + `/api/chat/context` + `/api/chat/turns` | [M9](./prd/09-on-device-inference.md) |
| Power-user BYO LLM | connect/edit/delete backends, embedding model, connection test | [M10](./prd/10-byo-llm-backends.md) |
| MCP & tools | connect MCP servers, registry search, per-tool toggles, compile toolkit | [M11](./prd/11-mcp-tools.md) |
| Import AI history | ChatGPT/Claude/Gemini/Grok export + paste fallback | [M12](./prd/12-import-history.md) |
| Domains & upgrade | pricing, portfolio picker, live availability, claim vanity subdomain, restyle | [M13](./prd/13-domains-upgrade.md) |
| Read replies aloud | on-device TTS (pocket-tts equivalent) | [M14](./prd/14-tts-read-aloud.md) |
| Admin (owner) | invites, waitlist, accounts | [M15](./prd/15-admin.md) |
| Cross-cutting | offline cache, deep links, push, theming, accessibility, telemetry | [M16](./prd/16-cross-cutting.md) |
| App shell & foundation | project setup, navigation, capabilities bootstrap, API SDK | [M1](./prd/01-foundation.md) |

Nothing in the web app is out of scope. Where a web behavior is browser-only
(force-graph canvas, in-browser TTS, ⌘K palette, clipboard), the mobile app
provides a native equivalent — see §9.

---

## 3. Architecture

### 3.1 High-level

```
┌──────────────────────────────────────────────────────────────┐
│  Native app (iOS / Android)                                    │
│                                                                │
│  UI layer (screens per PRD)                                    │
│  ── Vault · Memory · Chat · Tools · Domains · Admin · Auth     │
│                                                                │
│  Feature stores (state, optimistic mutations, offline queue)   │
│                                                                │
│  ┌────────────────┐   ┌──────────────────────────────────┐    │
│  │ HyperVault SDK │   │ Inference layer                  │    │
│  │ (typed REST)   │   │  ├─ OnDeviceModel (Apple/Gemini)  │    │
│  │  Bearer JWT    │   │  ├─ WebLLMModel  (bundled webview)│    │
│  └───────┬────────┘   │  └─ RemoteBackend (via /api/chat) │    │
│          │            └──────────────┬───────────────────┘    │
│  ┌───────┴──────────────┐            │                        │
│  │ Supabase auth SDK    │            │ context/turns split    │
│  │ (PKCE, secure store) │            │                        │
│  └──────────────────────┘            │                        │
└──────────┬───────────────────────────┴────────────────────────┘
           │ HTTPS (Authorization: Bearer <supabase jwt>)
           ▼
   HyperVault Next.js API  ───►  Supabase (Postgres + RLS + pgvector)
   (unchanged routes + 3 new endpoints for mobile)   Stenographer (opt.)
```

### 3.2 Recommended client stack

**React Native + Expo (dev client, not managed-only).** Rationale:

- **One codebase, both platforms**, with first-class native modules for the
  two things that matter here: secure storage (`expo-secure-store`) and a
  WebView (`react-native-webview`) to host **WebLLM** as the universal
  on-device fallback.
- **Reuse.** The canonical message format, recall context, and API shapes are
  the same the web app uses. TypeScript end-to-end means the SDK types can be
  generated from the same source of truth.
- **On-device model bridges** are thin native modules (Swift for Apple
  Foundation Models, Kotlin for AICore/Gemini Nano) exposed through a single
  `OnDeviceModel` TS interface (§5). Expo config plugins wire them in.
- **Supabase** has an official JS SDK that runs in RN with `AsyncStorage`/
  `expo-secure-store` as the session store and PKCE flow support.

> Native-native (Swift + Kotlin, two codebases) is a valid alternative if the
> team prefers it, but doubles the surface and loses the WebLLM webview reuse.
> The PRDs are written stack-agnostically at the task level; only M1/M9/M14
> name RN/Expo APIs, and each flags the native-native substitution.

### 3.3 Layers

- **HyperVault SDK** — a typed wrapper over the REST API (§6). One place that
  knows base URL, auth header injection, ret/backoff, and error normalization
  (every API error is `{ error: string }` — surface it verbatim). Generated
  types where possible from the route inventory in
  [`prd/api-contract.md`](./prd/api-contract.md).
- **Auth module** — Supabase session lifecycle, token refresh, secure storage,
  invite-gate resolution. Emits the Bearer token the SDK attaches.
- **Inference layer** — the `ChatModel` strategy interface with three
  implementations (on-device, WebLLM, remote). The chat feature store depends
  only on the interface (§5).
- **Feature stores** — per-domain state with optimistic updates and an offline
  mutation queue (§7).

---

## 4. Backend changes (done in this change set)

The API was **95% mobile-ready already** — every vault/memory/chat/mind/tools
route accepts `resolveApiIdentity`, which we extended. Three additions ship
with this handoff so the phone has everything it needs:

### 4.1 Bearer-token (Supabase JWT) auth — `lib/api-auth.ts`

`resolveApiIdentity` now accepts, in priority order:

1. `X-HyperVault-Key: hv_…` (agents / MCP) — unchanged.
2. **`Authorization: Bearer <supabase-access-token>`** — **new.** The
   service-role client validates the JWT (`admin.auth.getUser(token)`), applies
   the same invite/waitlist gate and 120 req/min/user rate limit as a web
   session, and returns `{ userId, via: "bearer", email }`.
3. Supabase SSR session cookie (web) — unchanged.

This is the key unblocker: a native app holds a JWT, not an SSR cookie, and
now authenticates to **every** `resolveApiIdentity` route without minting an
API key. (Session-only routes — `/api/keys`, `/api/artifacts/[slug]/source`,
`/api/invite/redeem`, `/api/admin/*` — still require session **or** bearer; see
[M2](./prd/02-auth-onboarding.md) T-M2-09 for the two routes that need a follow-up
to accept bearer, `/api/keys` in particular.)

### 4.2 Capabilities bootstrap — `GET /api/capabilities`

One unauthenticated call returns everything the app needs to configure itself:
canonical `app_url`, public Supabase creds for the on-device auth client,
feature flags (`deep_memory`, `key_encryption`, `on_device_inference`), hard
limits (byte/char caps, rate limits, max backends/servers/subdomains), the
provider registry, the vanity portfolio, and the theme catalog. Passing a
credential enriches it with a `user` block. See
[M1](./prd/01-foundation.md) T-M1-04.

### 4.3 On-device chat split — `POST /api/chat/context` + `POST /api/chat/turns`

The existing `POST /api/chat` couples context assembly to a **server-side**
model call, so it can't drive an on-device model. The split preserves the
entire HyperVault context pipeline for client-side inference:

- **`/api/chat/context`** (pure read) assembles the same system prompt the
  server would — wiki recall (artifacts + memory excerpts), smart-context
  compaction, deep-memory GraphRAG, and learned thumbs-up/down style
  preferences — and returns `{ system, messages, next_position, recalled,
  recalled_memories, smart_context, deep_memory }`. The on-device model runs
  inference on exactly this.
- **`/api/chat/turns`** (single writer) persists the user message + the
  locally generated reply, bumps the conversation, feeds the stenographer
  sidecar, and mirrors the thread into the wiki (git-mind commit) — identical
  side effects to server chat. Creates the conversation on the first turn.

Tool dispatch stays server-side (semantic dispatch needs the compiled toolkit
runtime), so on-device chat is tool-free; power users who need tools pick a
remote backend and use `POST /api/chat`. This is documented, not a bug.

> No other backend changes are required for parity. Everything else the mobile
> app does maps onto existing routes (see the contract doc). Streaming is a
> known gap — see §11.

---

## 5. On-device model strategy

The chat feature depends on one interface:

```ts
interface ChatModel {
  id: string;
  label: string;
  kind: "on-device" | "webllm" | "remote";
  available(): Promise<boolean>;
  // Streams tokens; resolves with the full text. `system` + `messages`
  // come straight from POST /api/chat/context.
  generate(input: {
    system?: string;
    messages: CanonicalMessage[];
    signal?: AbortSignal;
    onToken?: (t: string) => void;
  }): Promise<{ text: string; model: string }>;
}
```

Resolution order (configurable in Settings, this is the default ladder):

1. **Platform on-device model** — iOS ≥ 18 Apple Foundation Models
   (`FoundationModels` framework) via a Swift native module; Android via
   AICore / Gemini Nano (`com.google.ai.edge` / ML Kit GenAI) via a Kotlin
   module. `available()` gates on OS version + model download state.
2. **WebLLM** — a bundled `react-native-webview` running
   [WebLLM](https://github.com/mlc-ai/web-llm) with a small quantized model
   (e.g. Llama-3.2-1B/3B-Instruct or Qwen2.5). Universal fallback that works on
   any device with enough RAM; the model file is downloaded once and cached
   (mirror the pocket-tts "download once, cache offline" UX). Bridge is a
   `postMessage` protocol: RN posts `{system, messages}`, the webview streams
   `{token}` / `{done, text}`.
3. **Remote backend** — the user's connected `llm_backends` row, driven through
   the existing `POST /api/chat`. Selected explicitly (power user) or auto when
   1 and 2 are unavailable and a backend exists.

**Chat flow with on-device/WebLLM:**

```
user sends message
  → POST /api/chat/context {message, conversation_id?}   // assemble context
  → model.generate({system, messages})                    // on device, streams
  → POST /api/chat/turns {conversation_id?, user_message, assistant_content, model}
  → store returns conversation_id + reply id; UI attaches per-turn actions
```

**Chat flow with a remote backend** is the existing single call: `POST
/api/chat {backend_id, message, …}`.

The model picker in the composer lists all three kinds uniformly; switching is
lossless because history is canonical and server-side.

---

## 6. API usage map

Full request/response contract: [`prd/api-contract.md`](./prd/api-contract.md)
(generated from the route inventory). Highlights the mobile app depends on:

- **Auth:** every call carries `Authorization: Bearer <jwt>`. `GET
  /api/capabilities` bootstraps config. Invite gate resolved via
  `account_access` / `rpc('redeem_invite_code')`.
- **Vault:** `POST /api/save`, `GET/PATCH/DELETE /api/artifacts`,
  `GET /api/artifacts/[slug]/source|feedback`, `POST …/feedback`.
- **Graph/connections:** `GET/POST/DELETE /api/connections`.
- **Sharing:** `GET/POST/DELETE /api/shares`.
- **Memory wiki:** `GET/POST /api/memories`, `GET/PATCH/DELETE
  /api/memories/[id]`, `GET …/history`, `POST /api/memories/import`.
- **Git-mind:** `/api/mind/commits|branches|branches/[name]|state|merge|diff`,
  `/api/mind/revert`.
- **Chat:** `POST /api/chat` (remote), **`POST /api/chat/context` + `POST
  /api/chat/turns`** (on-device), `GET/POST /api/conversations`,
  `GET/PATCH/DELETE /api/conversations/[id]`, `POST /api/messages/[id]/feedback`,
  `GET/PATCH /api/chat-settings`.
- **Backends:** `GET/POST/PATCH/DELETE /api/backends`.
- **Tools/MCP:** `GET/POST /api/mcp-servers`, `PATCH/DELETE
  /api/mcp-servers/[id]`, `POST …/refresh`, `GET /api/toolkits`, `POST
  /api/toolkits/compile`, `GET /api/registry/search`.
- **Domains:** `GET/POST/PATCH /api/claim-domain`.
- **Themes:** `PATCH /api/dashboard-theme`.
- **Keys (power user):** `POST/DELETE /api/keys` (session/bearer only).
- **Import:** `POST /api/import`.
- **Admin:** `/api/admin/*` (owner only).

---

## 7. Data, offline & sync

- **Source of truth is the server.** The app caches for read-latency and
  offline viewing, never as an alternate store.
- **Read cache:** persist the last vault list, open conversations, memory
  browse list, branches, and capabilities. Stale-while-revalidate. Cache keys
  are per-user (namespaced by `user.id`) and cleared on sign-out.
- **Offline queue:** mutations that are safe to defer (save artifact, memorize,
  feedback, visibility toggle, connect) enqueue when offline and replay on
  reconnect, with optimistic UI and rollback on failure. Chat turns via
  on-device model can be *generated* offline and the `POST /api/chat/turns`
  persist deferred — this is a headline offline capability, call it out in M9.
- **Conflict posture:** last-write-wins for simple fields; the git-mind merge
  UI handles memory conflicts explicitly (that's what it's for). Do not invent
  client-side merge for memories — round-trip to `/api/mind/merge`.
- **Idempotency:** `POST /api/save` dedupes by content hash; `POST /api/import`
  dedupes by external id; connect is idempotent. Safe to retry.

---

## 8. Auth architecture

Detailed in [M2](./prd/02-auth-onboarding.md). Summary:

- **Sign-in:** Supabase JS client on device with `flowType: 'pkce'`,
  `detectSessionInUrl: false`, secure storage. `signInWithOAuth({ provider:
  'google', options: { redirectTo: 'hypervault://auth/callback',
  skipBrowserRedirect: true }})`, open the URL in
  `ASWebAuthenticationSession` / Chrome Custom Tab, catch the deep link,
  `exchangeCodeForSession(code)`.
- **Redirect allow-list:** `hypervault://auth/callback` (and an
  `https://hypervault.store/auth/mobile` universal-link variant) must be added
  to the Supabase Auth redirect allow-list — an **ops task**, flagged in M2.
- **Alternative (recommended to also support):** native Google Sign-In →
  `signInWithIdToken` (no deep link, best UX). M2 lists both; ship deep-link
  first, id-token as a fast-follow.
- **Token storage:** access + refresh JWT in `expo-secure-store`
  (Keychain/Keystore). `autoRefreshToken: true`.
- **Invite gate:** after sign-in, read `account_access`; if absent, show the
  waitlist/redeem screen and call `rpc('redeem_invite_code')` (or `POST
  /api/invite/redeem` once it accepts bearer — see M2 T-M2-09). Admin emails
  bypass.
- **No cookies, no vanity-host routing** on device — always target the
  canonical `app_url` from capabilities.

---

## 9. Native equivalents for browser-only web behaviors

| Web behavior | Native approach |
| --- | --- |
| In-browser TTS (`pocket-tts-js`, on-device, download-once) | On-device TTS: iOS `AVSpeechSynthesizer` / Android `TextToSpeech` for v1; optional bundled neural TTS (pocket-tts in the WebLLM webview) for parity. Same "speaker button per reply, tap to stop" UX. [M14](./prd/14-tts-read-aloud.md) |
| Force-directed graph (`react-force-graph-2d`, canvas, `ssr:false`) | Native graph: `react-native-skia` + a force sim (`d3-force`) or a WebView-hosted force-graph. Same node/edge encodings, 150-node/kind cap, tap-to-open. [M4](./prd/04-vault-graph.md) |
| ⌘K / Ctrl-K command palette | A search affordance + a global search sheet (pull-down or a nav search icon). [M6](./prd/06-memory-wiki.md) |
| List ⇆ Graph toggle; Search/Ask/Graph tabs | Segmented controls / tab bars. |
| Clipboard copy (links, source, keys, share) | `expo-clipboard`. |
| Client `file.text()` import; FormData upload | `expo-document-picker` + `expo-file-system`; multipart upload to `/api/memories/import`. [M12](./prd/12-import-history.md) |
| Add-to-Home-Screen instructions modal | N/A on native (the app *is* installed). Replace with a native **Share** sheet for the artifact URL. [M3](./prd/03-vault-artifacts.md) |
| Tap-to-confirm / `window.confirm` destructive actions | Native confirm (Alert / action sheet). |
| `router.refresh()` optimistic patterns | Store-level optimistic update + revalidate. |
| Deep-link params (`?source_prompt=`, `?open=`, `?branch=`, `?invite=`) | Universal links + `hypervault://` scheme routes. [M16](./prd/16-cross-cutting.md) |

---

## 10. Security & privacy

- **No secrets in the client bundle.** Only public `NEXT_PUBLIC_*` values (from
  capabilities) live on device. The Supabase anon key is public by design.
- **Power-user LLM/MCP keys:** by default store them server-side (encrypted at
  rest, AES-256-GCM, as the web app does — `POST /api/backends`). If
  `capabilities.features.key_encryption` is false, keep them in
  `expo-secure-store` on device and drive that backend directly (never send a
  key the server can't protect). Flag this branch in M10.
- **On-device inference is private:** prompts and replies for the on-device /
  WebLLM path never leave the device except the persisted transcript the user
  already stores in their own vault via `/api/chat/turns`. Make that explicit
  in the model picker.
- **Transport:** TLS only; pin the canonical origin. Reject non-HTTPS
  `app_url`.
- **Least privilege:** the app authenticates as the user (bearer), so RLS
  applies exactly as on web. Never ship the service-role key.
- **External content caution:** artifact HTML, memory content, MCP tool output,
  and imported transcripts are untrusted. Render artifact HTML in a sandboxed
  WebView (no same-origin to the app), and treat MCP/registry results as data.

---

## 11. Non-functional requirements

- **Performance:** vault list < 400 ms to first paint from cache; on-device
  first token < 2 s on a mid-tier 2024 phone with the 1–3B model warm.
- **Offline:** browse vault, read conversations, memorize, and chat on-device
  work fully offline; writes queue.
- **Accessibility:** full screen-reader labels, dynamic type, 44pt touch
  targets, reduced-motion honored by the graph and any animation.
- **Theming:** honor the user's `profiles.theme` (dashboard theme) and light/
  dark. Theme catalog comes from capabilities.
- **Streaming gap:** the server `POST /api/chat` is non-streaming (returns
  after the full turn, up to 120 s). For remote backends the app shows a
  determinate "thinking" state; **on-device/WebLLM streams natively** (that's a
  UX reason to default to on-device). A future `POST /api/chat` SSE variant is
  out of scope here but noted for the backend roadmap.
- **Versioning:** the app reads `capabilities.api_version`; on mismatch beyond a
  supported window, show a soft "update available" prompt.

---

## 12. Release phases

- **Phase 0 — Foundation (M1, M2):** app shell, navigation, capabilities
  bootstrap, auth + invite gate, SDK. *Exit: sign in, land in an empty vault.*
- **Phase 1 — Vault (M3, M4, M5):** artifacts CRUD, save-from-chat, graph,
  connections, sharing. *Exit: full artifact lifecycle on phone.*
- **Phase 2 — Memory (M6, M7):** wiki Search/Ask/Graph, memorize/import,
  git-mind. *Exit: memory parity.*
- **Phase 3 — Chat (M8, M9, M10):** server-backend chat, on-device/WebLLM,
  BYO backends. *Exit: the headline mobile experience.*
- **Phase 4 — Extended (M11, M12, M13, M14):** MCP/tools, import, domains,
  TTS. *Exit: full parity.*
- **Phase 5 — Polish (M15, M16):** admin, offline, push, deep links, a11y,
  telemetry. *Exit: store-ready.*

---

## 13. Open questions (resolve before/early in build)

1. **Stack:** confirm React Native + Expo vs native-native. (Affects M1/M9/M14
   task specifics only.)
2. **On-device models:** which quantized model ships as the WebLLM default, and
   the minimum-RAM gate below which we fall back to remote?
3. **Ops — Supabase redirect allow-list:** who adds `hypervault://auth/callback`
   + the universal-link domain? (Blocks M2.)
4. **`/api/keys` + `/api/invite/redeem` bearer support:** confirm we extend
   these two session-only routes to accept bearer (M2 T-M2-09) vs. requiring an
   in-app webview session for them.
5. **Pricing / Pro upgrade:** does mobile process payment (App Store IAP vs.
   external), or is upgrade web-only with the app deep-linking out? (Affects
   M13 scope — default assumption: claim flow in-app, payment via web link to
   avoid IAP complications until decided.)
6. **Push:** what events warrant push (share received, invite approved, agent
   saved to your vault)? (Shapes M16.)
```
