# M13 — Domains & Upgrade

**Status:** Draft · **Epic:** M13 · **Depends:** M2 (authed identity); theme catalog from M1 capabilities

## Goal

Bring the Free-vs-Pro upgrade and vanity-domain flow to the phone: a
pricing/compare screen, the domain portfolio picker from
`capabilities.domains` (featured + coming-soon), a name input with client-side
validation and debounced live availability, one-tap claim, per-realm restyle,
and the owner's own dashboard-theme picker. The claim flow itself runs in-app
against `GET/POST/PATCH /api/claim-domain`. **Payment is the open question**
(spec §13.5): default assumption is claim in-app but route Pro **payment** out
to an external web link to avoid App Store IAP complexity until product
decides — this epic gates and deep-links payment out and flags it.

## User stories

- As a user, I can compare Free vs Pro and understand what a Pro upgrade gives
  me.
- As a user, I can browse the domain portfolio, pick a base domain, type a
  name, and see live whether `name.base` is available.
- As a user, I can claim an available subdomain and see it become mine, with my
  realm badge.
- As a user, I can restyle a claimed subdomain's theme, and restyle my own
  signed-in dashboard theme.
- As a product owner, mobile never ships an unreviewed IAP surface — payment is
  gated behind an external link until we decide.

## Tasks

| ID | Title | Pts | Depends | Description / Acceptance |
| --- | --- | --- | --- | --- |
| T-M13-01 | Pricing / Free-vs-Pro compare screen | 1 | T-M1-08 | Upgrade screen with Free ($0/forever) and Pro ($8/mo) cards and their feature lists, mirroring web copy (permanent vault, up to `max_pro_subdomains` legendary addresses, vault on every subdomain, custom landing, priority rendering). Acceptance: both plans render with feature lists in the active theme; Pro is visually highlighted. |
| T-M13-02 | Domain portfolio picker | 2 | T-M13-01 | Grid of `capabilities.domains` entries: base domain (mono), tagline, **Featured** badge, **Coming soon** badge for `available:false` (disabled/greyed). Selecting a base updates the live `name.base` preview on each card. Featured/first-available pre-selected. Acceptance: available domains are selectable; coming-soon ones aren't; the preview updates with the selected base. |
| T-M13-03 | Name input + client validation | 1 | T-M13-02 | Lowercased, no-autocorrect subdomain input with client-side `validateSubdomain` rules (length/charset). Invalid names show the reason inline and block claim before any request. Live preview `name.base`. Acceptance: an invalid name shows its error and disables claim; a syntactically valid one clears it. |
| T-M13-04 | Debounced live availability | 2 | T-M13-03 | On name/base change (debounced ~350 ms, abortable) call `GET /api/claim-domain?name=&base=` (public, 30/min/IP). States: idle / checking / available (✓) / unavailable (reason). A non-OK response (rate limit/hiccup) stays quiet — claim still validates server-side. `aria-live` announces the result. Acceptance: typing a name checks availability after debounce; taken names show the reason; the check never blocks claiming. |
| T-M13-05 | Claim a subdomain | 2 | T-M13-04 | Claim → `POST /api/claim-domain {desired_name, base_domain}` → `{domain,url,claimed,max_subdomains,message}`. Busy state; on success show the claimed domain + a "Visit it" link (opens `url`). Handle **403** (max subdomains reached → explain the `max_subdomains` cap) and **409** (taken → prompt another name). Disable claim while busy, when the name is empty, or when availability is unavailable. Acceptance: an available name claims and shows success; a 403 explains the cap; a 409 nudges to another name. |
| T-M13-06 | Realm badges + claimed-realm list | 1 | T-M13-05 | Show the user's claimed realms (from `capabilities.user` / profile / claim responses) with badges, each linking out to its `url`. Acceptance: claimed subdomains list with badges; a freshly claimed one appears without a manual reload. |
| T-M13-07 | Restyle a claimed subdomain's theme | 2 | T-M13-06, T-M1-07 | Per-realm theme picker (theme catalog from `capabilities.themes`) → `PATCH /api/claim-domain {subdomain, base_domain, theme}` → `{domain,theme,message}`. Optimistic select with rollback on failure; 503 shown verbatim. This changes what visitors see (not the owner's own surfaces). Acceptance: changing a realm's theme persists and the row reflects it; a failure rolls back and shows the error. |
| T-M13-08 | Dashboard theme picker (owner's own surfaces) | 1 | T-M1-07 | Theme picker for the owner's signed-in surfaces (`profiles.theme`) → `PATCH /api/dashboard-theme {theme:styleId|null}` → `{theme,message}`. Optimistic; the whole app repaints live in the new theme (feeds M1's theme provider). Handle 400 (unknown style) / 503. Acceptance: picking a theme restyles the app immediately and persists; unknown/blank falls back to default; failure rolls back. |
| T-M13-09 | Gate & deep-link Pro payment out (flag) | 1 | T-M13-01 | **Open-question task (spec §13.5).** Do NOT implement in-app payment. The Pro CTA opens the external web upgrade/checkout in the system browser (`app_url` upgrade route) rather than triggering App Store IAP; claim of a subdomain stays in-app. Add a single, well-labeled seam so payment can later become IAP or stay web-linked per the product decision. **Flag:** payment mechanism (IAP vs external web) is unresolved and blocks App Store review posture — surface to product before store submission. Acceptance: tapping "Upgrade to Pro / pay" opens the external checkout link; no IAP SDK is bundled; the flag is documented at the CTA. |

## Out of scope / notes

- **Payment is unresolved (spec §13.5).** Default: claim in-app, payment via
  external web link to sidestep IAP review complexity. T-M13-09 isolates the
  decision; do not add StoreKit/Play Billing until product signs off — Apple may
  require IAP for digital upgrades, which is exactly the risk being deferred.
- `GET /api/claim-domain` is public and IP-rate-limited (30/min); availability
  is a convenience — the authoritative check is the `POST` claim.
- No host-based routing on device (spec §8) — realm links open externally to the
  vanity URL; the app itself always targets the canonical `app_url`.
