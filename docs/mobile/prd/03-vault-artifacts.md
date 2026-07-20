# M3 — Vault — Artifacts

**Status:** Draft for implementation handoff
**Epic:** M3 · Vault — Artifacts
**Depends:** M1 (SDK, capabilities, navigation), M2 (auth + invite gate)

Read [`../00-engineering-spec.md`](../00-engineering-spec.md) and
[`00-index.md`](./00-index.md) first — the conventions there (Bearer auth,
`{ error }` toasts, loading/empty/error states, optimistic + revalidate,
native confirm, limits from capabilities, theming + a11y) are inherited by
every task below and are not repeated.

## Goal

Full artifact lifecycle on the phone: browse the vault, open the "New from
chat" save flow, read raw source, flip visibility, delete, share the artifact
URL, copy multi-realm links, thumbs-feedback, and manage agent API keys — the
web `/vault` dashboard and `/vault/new` page reproduced natively. The web's
force-graph toggle and connect/invite controls live in M4/M5; this epic builds
the list, the cards, and the save form plus the dashboard chrome (realm badges,
API keys card).

## User stories

- As a signed-in user I land in my vault and see my artifacts newest-first,
  each with its type, badges, tags, date, and connection count.
- As a user I tap the type chip to read the raw stored source and copy it.
- As a user I flip an artifact between public and private in one tap.
- As a user I delete an artifact with a confirm step.
- As a user I paste something my AI made, optionally force plain-HTML, keep the
  source prompt, and get back a live `/a/<slug>` link.
- As a user I share an artifact's link through the native Share sheet, or copy
  it — picking which of my claimed realms it should live on when I have several.
- As a user I open an artifact and it renders in a sandboxed WebView.
- As a user I thumbs-up / thumbs-down an artifact.
- As a power user I generate and revoke agent API keys from the vault.
- As a user I see my plan and claimed-realm badges, with a path to claim one.

## Tasks

| ID | Title | Pts | Depends | Description / Acceptance |
| --- | --- | --- | --- | --- |
| T-M3-01 | Vault list screen | 2 | — | Vault tab fetches `GET /api/artifacts` → `items[]` and renders them newest-first (server already caps at 200) as a scrollable list. Loading, empty ("flight deck is empty" with a Save-your-first-artifact CTA to the New-from-chat screen), and error states. Pull-to-refresh revalidates; last list is served from the M1 read cache first (stale-while-revalidate). Header shows the artifact count ("N artifacts on your flight deck"). |
| T-M3-02 | Artifact card | 2 | T-M3-01 | Card per item: title; type chip (opens view-source, T-M3-03); `is_jsx` → "React · auto-wrapped" accent badge; `is_pwa` → "Installable" outline badge; `created_at` as a locale date; connection count "🔗 N connection(s)" when > 0 (count from T-M3-11 data); `tags` as `#tag` mono chips. Action row hosts the visibility toggle, Open, Share/Copy-link, feedback, and (from M5) Connect. 44pt targets, screen-reader labels per control. |
| T-M3-03 | View-source sheet | 1 | T-M3-02 | Tapping the type chip opens a bottom sheet / modal that fetches `GET /api/artifacts/[slug]/source` (session/bearer-only route) → `{ content }` and shows it read-only in a monospace, selectable, scrollable block. Copy button writes `content` to the clipboard via `expo-clipboard` ("Copied!" for ~1.5s). Loading + error (verbatim `{ error }`, e.g. 404/401) states; abort the fetch on close. |
| T-M3-04 | Source-prompt disclosure | 1 | T-M3-02 | When `source_prompt` is present, the card shows a collapsible "💬 Source prompt" disclosure that expands to the stored prompt (quoted, wrapped). Collapsed by default; accessible expand/collapse control. |
| T-M3-05 | Visibility toggle | 1 | T-M3-02 | Toggle button shows "🔒 Private" / "🌐 Public" (missing/absent `visibility` reads as public — pre-0016 DBs). Tap calls `PATCH /api/artifacts` `{ id, visibility }` with the flipped value; optimistic flip, roll back + toast on error. Explain-on-long-press/title matching the web tooltip copy. |
| T-M3-06 | Delete artifact | 1 | T-M3-02 | Delete uses a native confirm (Alert/action sheet, mirroring the web tap-to-confirm). On confirm, `DELETE /api/artifacts` `{ id }`; optimistically remove from the list (and graph/counts), roll back on failure with the verbatim error. |
| T-M3-07 | "New from chat" save form | 2 | T-M3-01 | Screen with Title, "Paste from chat" (monospace), Source prompt, and Connect-to (comma-separated titles/slugs) fields. Submits `POST /api/save` `{ title (default "Untitled"), content, connect_to[], make_pwa, force_html, visibility, source_prompt? }`. Save button disabled until content is non-empty; busy label while posting. On success render the result card with `message` and the tappable `url` (`/a/<slug>`) that opens via T-M3-10; on `duplicate:true` show the dupe message. Errors verbatim; keep the content in the field on network failure. |
| T-M3-08 | Save-form toggles + client limits | 1 | T-M3-07 | Three toggles: "Keep it private" (default on → `visibility:"private"`), "Make it installable" (default on → `make_pwa`), "Force plain HTML (skip React/JSX auto-detection)" (default off → `force_html`). Enforce capabilities limits client-side before POSTing: content ≤ `artifact_bytes` (1 MB) and `source_prompt` ≤ `source_prompt_chars` (10k) — block with an inline message rather than a 413 round-trip. Note in helper text that JSX auto-detection happens server-side and Force-plain-HTML overrides it. |
| T-M3-09 | Deep-link `?source_prompt=` prefill | 1 | T-M3-07 | Opening the New-from-chat screen via the `source_prompt` deep-link param (universal link / `hypervault://` route, wired in M16) prefills the Source-prompt field with the decoded value so an agent can hand off a prompt. No-op when the param is absent. |
| T-M3-10 | Open artifact in sandboxed WebView | 2 | T-M3-01 | "Open ↗" (and result-card link) opens `<realm-or-app_url>/a/<slug>` in a sandboxed `react-native-webview` — no same-origin to the app, external content treated as untrusted per spec §10. Screen has a title bar with a Share action (T-M3-11) and close. Handles load errors. |
| T-M3-11 | Native Share + copy-link (multi-realm) | 2 | T-M3-02 | Replace the web Add-to-Home-Screen modal (N/A on native) with the OS **Share** sheet (`expo-sharing`/RN `Share`) for the artifact URL. Separate Copy-link action writes the URL to the clipboard; when the user has ≥ 2 claimed realms, first present a host picker (action sheet listing each `{sub}.{base}` realm) so they choose which host the link uses — `/a/<slug>` serves identically from every realm and from `app_url`. With 0–1 realms, copy directly (using the single realm, else `app_url`). Fetch connection counts here or in T-M3-01 via `GET /api/connections` to feed T-M3-02. |
| T-M3-12 | Artifact feedback (up/down) | 1 | T-M3-02 | Thumbs up/down control on the card (or WebView title bar). Load current state with `GET /api/artifacts/[slug]/feedback` → `{ feedback:"up"|"down"|null }`; tapping posts `POST /api/artifacts/[slug]/feedback` `{ feedback }`, toggling back to `null` when re-tapping the active choice. Optimistic; handle `503` (migration 0017) verbatim. |
| T-M3-13 | Agent API keys card | 2 | T-M3-01 | Vault dashboard card mirroring the web ApiKeysCard. Lists existing keys (`prefix…`, created/last-used) from the M1 capabilities/user context or a direct Supabase read of the user's `api_keys`; "Generate new key" calls `POST /api/keys` (session/bearer-only, 5/min) and shows the raw key **once** in a copy-me banner; "Revoke" uses a native confirm then `DELETE /api/keys` `{ id }`. Note: bearer support on `/api/keys` is the M2 T-M2-09 follow-up — gate this card on that landing (else drive it through an in-app webview session). |
| T-M3-14 | Dashboard chrome: plan + realm badges | 1 | T-M3-01 | Header shows the plan badge (Pro/Free) and one tappable badge per claimed realm (`{sub}.{base}`, opens the realm in the browser). When the user has no realm show a "Claim your realm" button; when they have some but fewer than `max_pro_subdomains`, show "Claim another (n/max)". Both deep-link into M13 (Domains & Upgrade). Realm list comes from the M1 user/capabilities context (profile `vanity_subdomain` + domain claims). |

## Out of scope / notes

- **Graph view & the List⇄Graph toggle** are M4; **Connect** and **Invite a
  user** (the web card's dropdown + email panel) are M5 — the card leaves room
  for those controls but does not implement them here.
- `GET /api/artifacts` does not return connection counts; derive them from
  `GET /api/connections` (T-M3-11) — the same fetch M4/M5 need, so share it in
  the vault feature store.
- All save/visibility/feedback mutations are offline-queue-eligible per spec §7;
  wire them to the M1 queue where present, else best-effort online.
- The web's `is_jsx`/`is_pwa`/`visibility`/`type` fields come straight from
  `GET /api/artifacts`; do not recompute JSX-ness on device (server-side only).
</content>
</invoke>
