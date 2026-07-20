# M5 — Connections & Sharing

**Status:** Draft for implementation handoff
**Epic:** M5 · Connections & Sharing
**Depends:** M3 (vault list, artifact cards, connection fetch)

Read [`../00-engineering-spec.md`](../00-engineering-spec.md) and
[`00-index.md`](./00-index.md) first — inherited conventions (Bearer auth,
verbatim `{ error }`, optimistic + revalidate, native confirm, a11y) are not
repeated.

## Goal

The relationship layer of the vault: connect an artifact to another artifact or
a memory, remove an edge, invite another HyperVault user to an artifact by
email (and revoke that access), and browse artifacts other people shared with
you (with a Leave action). This reproduces the web `ConnectControl` /
`InvitePanel` dropdown and the `SharedWithYou` section natively.

## User stories

- As a user I connect an artifact to a related artifact or memory, and the edge
  shows up in my graph and connection counts immediately.
- As a user I remove a connection I no longer want.
- As a user I invite someone to an artifact by their email, and I see who
  currently has access.
- As an owner I revoke a person's access to an artifact.
- As a user I see the artifacts other people invited me to, open them, and
  leave any I no longer want.

## Tasks

| ID | Title | Pts | Depends | Description / Acceptance |
| --- | --- | --- | --- | --- |
| T-M5-01 | Connect picker | 2 | M3 | "Connect" action on the artifact card opens a picker grouped into **Artifacts** (every other artifact by title) and **Memories** (memory titles from the M4/M6 data). Selecting a target and confirming calls `POST /api/connections` `{ source: artifact.id, target }` (target is an id/slug/title of an artifact or id/title of a memory). Optimistically add the edge (update graph + connection counts), roll back + verbatim error (400/404) on failure. Connect is idempotent, so retry is safe. |
| T-M5-02 | Remove a connection | 1 | T-M5-01 | An edge inspector (from the connect picker's "current connections" list, or a long-press on a graph edge) offers Remove, which — after a native confirm — calls `DELETE /api/connections` `{ id }` → `{ deleted }`. Optimistically drop the edge from graph + counts; roll back on error. Edge `id`s come from `GET /api/connections`. |
| T-M5-03 | Invite a user to an artifact | 2 | M3 | From the card's Connect/Share entry point, an "Invite a user" panel takes an email and calls `POST /api/shares` `{ artifact: artifact.id, email }` → `{ shared_with, message }`. Show the returned `message` (the invitee must already have a HyperVault account — any plan). Errors verbatim (400 no such user / 404 / 503). Email field validates non-empty before POST. |
| T-M5-04 | Current-access list + revoke | 2 | T-M5-03 | The invite panel loads current access with `GET /api/shares?artifact={id|slug}` (owner-only) → `{ shares:[{ id, email, display_name, created_at }] }` and lists each grantee as a chip. Removing a chip calls `DELETE /api/shares` `{ share_id }` (native confirm), optimistically dropping it and refreshing the list. Handle 400/404/503 verbatim. |
| T-M5-05 | "Shared with you" screen | 2 | M3 | A section/screen listing inbound shares: for each, the artifact title, a "react"/type badge, the owner's name, and the created date, with an "Open ↗" that opens `/a/<slug>` in the sandboxed WebView (M3 T-M3-10). Empty inbound list hides the section (matches web). Loading + error states. Data source: a direct Supabase read of the user's `artifact_shares` rows (RLS-scoped to `shared_with_id`) joined to artifact + owner profile — the mobile equivalent of the web's service-role fetch, since no REST list endpoint exists (see notes). |
| T-M5-06 | Leave a shared artifact | 1 | T-M5-05 | "Leave" on a shared-with-you card uses a native confirm (mirroring the artifact delete) then calls `DELETE /api/shares` `{ share_id }` with the inbound share's id → `{ message }`. Optimistically remove it from the list; a private artifact's link locks again once access is dropped. Roll back + verbatim error on failure. |
| T-M5-07 | Connect/Share entry point on the card | 1 | T-M5-01, T-M5-03 | Wire the M3 artifact card's action row to open the connect picker (T-M5-01) with the "Invite a user…" option routing to the invite panel (T-M5-03/04), reproducing the web dropdown's combined Connect + Sharing menu. Accessible labels; picker dismissable. |
| T-M5-08 | Revalidate graph + counts after edge/share changes | 1 | T-M5-01, T-M5-02 | After any connect/disconnect, revalidate `GET /api/connections` so the M3 connection counts and the M4 graph reflect the change (the web `router.refresh()` equivalent). Shared feature store; no full-screen reload. |

## Out of scope / notes

- **No inbound-shares REST endpoint** exists in the contract — `GET
  /api/shares?artifact=` is owner-only for one artifact. T-M5-05 reads
  `artifact_shares` directly from Supabase under RLS (allowed per the contract's
  "Direct Supabase" section for reads that lack a REST route). Flag a possible
  `GET /api/shares/inbound` follow-up so the app can drop the direct read.
- Memory targets in the connect picker depend on **M4/M6** for the memory list;
  artifact-only connect works without them.
- Sharing requires the invitee to already have a HyperVault account; the app
  does not send external invitations — surface the API's message verbatim when
  the email isn't found.
- All connect/disconnect/share/leave mutations are offline-queue-eligible per
  spec §7 where the M1 queue is present.
</content>
