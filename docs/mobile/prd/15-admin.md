# M15 — Admin (owner)

**Status:** Draft · **Epic:** M15 · **Depends:** M2 (authed identity + admin gate)

## Goal

Port the owner-only control room to the phone: invite codes (create / enable /
disable / destroy), the waitlist (approve / remove), and accounts (plan
upgrade/downgrade, approve/revoke access, delete). Gate the whole tab on admin
status (`capabilities.user` admin flag or a `profiles`/`account_access` admin
check). All destructive actions confirm natively, and self-targeting
destructive actions (delete/revoke your own account) are disabled, exactly as
web. **Note the endpoint gap:** there is **no GET list endpoint** for
invites/waitlist/accounts — the web page reads them via the admin Supabase
client server-side, so the app either reads them via direct Supabase (RLS/admin)
or needs a new backend list endpoint; this is flagged as a backend task.

## User stories

- As the owner, I only see the Admin tab if I'm an admin; everyone else can't
  reach it.
- As the owner, I can mint an invite code with a max-uses and note, and enable,
  disable, or destroy existing codes.
- As the owner, I can approve or remove people from the waitlist.
- As the owner, I can upgrade/downgrade an account's plan, approve or revoke its
  access, and delete an account — never my own.

## Tasks

| ID | Title | Pts | Depends | Description / Acceptance |
| --- | --- | --- | --- | --- |
| T-M15-01 | Admin gate + tab visibility | 1 | T-M2, T-M1-04 | Show the Admin tab/route only when the user is admin — check `capabilities.user` admin flag or a `profiles`/`account_access` admin/source check; non-admins are redirected away (mirror web `redirect("/vault")`). Acceptance: an admin sees the tab and screen; a non-admin can't navigate to it even by deep link. |
| T-M15-02 | Admin data fetch (backend list gap) | 2 | T-M15-01 | Load invites, waitlist, and accounts. **There is no GET list REST endpoint** — either read directly via the admin/RLS Supabase client (`invite_codes`, `waitlist`, `profiles`, `account_access`, as the web page does) **or** add backend list endpoints. **Flag — backend task:** add `GET /api/admin/invites|waitlist|accounts` (or confirm direct-Supabase-from-device is acceptable for admins). Distinguish a genuinely empty list from a missing-table/permission error (don't render "none" when the query failed). Acceptance: the three lists load for an admin; a query/schema error shows a distinct banner, not a false-empty; the chosen data path (direct vs new endpoint) is documented. |
| T-M15-03 | Invite codes — create | 1 | T-M15-02 | Create form: `maxUses` (default 1) + optional `note` → `POST /api/admin/invites {maxUses?,note?}` → prepend the returned `invite`. Busy state ("Minting…"). Acceptance: creating adds a code to the list with its uses/note; errors surface verbatim. |
| T-M15-04 | Invite codes — list, enable/disable, destroy | 2 | T-M15-03 | Render codes (code, `use_count/max_uses`, note, status badge Active/Used-up/Disabled, created date). Enable/disable → `PATCH /api/admin/invites/[id] {disabled}`. Destroy → native confirm ("Destroy invite code {code}?") → `DELETE /api/admin/invites/[id]`. Optimistic with rollback. Acceptance: toggling flips the status badge; destroy (after confirm) removes the row; cancel is a no-op. |
| T-M15-05 | Waitlist — approve / remove | 2 | T-M15-02 | List waitlist entries (email/id, joined date, oldest first). Approve → `PATCH /api/admin/accounts/[id] {approved:true}` (unlocks their vault). Remove → native confirm → `DELETE /api/admin/waitlist/[id]`. Acceptance: approving removes the entry and grants access; remove (after confirm) drops them; both handle errors verbatim and revalidate. |
| T-M15-06 | Accounts — list + plan upgrade/downgrade | 2 | T-M15-02 | Accounts table (email, display name, vanity subdomain, plan badge, access source badge or "waitlisted", created date; mark self). Plan toggle → `PATCH /api/admin/accounts/[id] {plan}` flipping free⇄pro. Optimistic with rollback. Acceptance: toggling plan updates the badge and persists; self is labeled; errors roll back. |
| T-M15-07 | Accounts — approve/revoke access + delete (self-guarded) | 2 | T-M15-06 | Approve/revoke → `PATCH /api/admin/accounts/[id] {approved}` (revoke disabled for self). Delete → native confirm ("Permanently delete {email} and everything they saved?") → `DELETE /api/admin/accounts/[id]`; **disabled for self**. All destructive actions confirm. Acceptance: revoke/delete are disabled on the admin's own row; deleting another account (after confirm) removes it; access toggle flips the source/waitlisted badge. |

## Out of scope / notes

- **Backend gap (flagged in T-M15-02):** the web admin page reads lists via the
  server-side admin Supabase client; there is no `GET /api/admin/*` list route.
  Decision needed — expose admin-scoped direct Supabase reads on device, or add
  `GET` list endpoints. All **mutating** admin routes already exist and are
  session/bearer-gated to admins.
- Admin routes are session/bearer + admin-gated (`resolveApiIdentity` admin
  check). The app authenticates via Bearer JWT (spec §4.1); no service-role key
  ever ships to the client (spec §10).
- Emails/display names in these lists are data — render as plain text.
