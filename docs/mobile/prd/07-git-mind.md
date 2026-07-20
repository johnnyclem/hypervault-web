# M7 — Git-for-a-Mind

**Status:** Draft for implementation handoff · **Epic:** M7 · **Depends:** M6 (memory wiki)

> Read [`../00-engineering-spec.md`](../00-engineering-spec.md) and
> [`00-index.md`](./00-index.md) first. Every endpoint used here is defined in
> [`api-contract.md`](./api-contract.md). Conventions (auth header, error
> toasts, loading/empty states, optimistic+revalidate, native confirms,
> theming + a11y) are inherited from the index and not repeated per task.

## Goal

Make the memory wiki a true **git for a mind** on the phone: version every
thought, branch ideas, merge understanding with conflict resolution, diff and
time-travel the memory graph, and restore any prior revision — all backed by
provenance. Storage is Postgres-native (commit/revision/branch tables, owner-only
RLS); the client only drives the `/api/mind/*` and `/api/memories/[id]/history`
endpoints. `public.memories` stays the live state of `main`, so branch `main`
behaves exactly like the un-versioned wiki. Every write is a commit; **history is
never rewritten** (restore lands as a *new* commit).

## User stories

- As a user, I see my branches as chips with memory counts and tap one to check
  it out (a stateless `?branch=` switch); the whole Memory screen reloads to
  that branch's state.
- As a user, I fork a new branch from where I am, and I delete a branch I'm done
  with (but `main` is protected and I'm warned if the branch has children).
- As a user, I merge a branch into main; clean memories merge in one tap, and
  when both sides diverged I get each conflict as **ours / theirs** cards (or a
  hand-edit box), pick per conflict, and resubmit.
- As a user, I open a memory's **History** and see every revision — an op badge
  (create/update/delete), the commit message, who committed it, and on which
  branch — expand any revision into a color-coded line diff, and restore an old
  version (which lands as a new commit).
- As a user, I time-travel to see exactly what my mind knew at a past commit or
  date, and I skim the latest commits on the current branch.

## Tasks

| ID | Title | Pts | Depends | Description / Acceptance |
| --- | --- | --- | --- | --- |
| T-M7-01 | Branch switcher | 2 | T-M6-01 | `GET /api/mind/branches` → chips (`branch: main [12] · ideas [3]`), each showing `name` + `memory_count`, current branch highlighted. Tapping a chip does a **stateless checkout**: navigate to the Memory screen with `?branch=<name>` (omit for `main`) and revalidate, so the list, graph, and every downstream call reload against that branch. Handle the pre-versioning case (only a synthetic `main` chip when no branch rows exist). |
| T-M7-02 | Create branch | 1 | T-M7-01 | "+ branch" reveals a name field; `POST /api/mind/branches` with `{ name, from: current }`. On success, check out the new branch (navigate `?branch=`). Handle `400` (bad name), `409` (already exists), `404` (bad `from`); surface the error text inline. |
| T-M7-03 | Delete branch | 1 | T-M7-01 | On a non-`main` branch, "Delete branch" with a native destructive confirm (mirrors web "Really delete?"). `DELETE /api/mind/branches/[name]`. On success, check out `main`. Never offer delete for the default branch (`400`); handle `409` (in use — a child was forked from it) by showing the "delete or merge the children first" error verbatim. |
| T-M7-04 | Merge dialog — clean merge | 2 | T-M7-01 | From a non-`main` branch, "Merge into main" opens a merge sheet. `POST /api/mind/merge` with `{ source: current, target: "main" }`. On a clean `200`, show the `merged` counts (`created/updated/deleted`) + `links_changed`, close, and check out `main`. Copy: one-side changes auto-merge, links merge set-wise. |
| T-M7-05 | Merge conflict resolution | 2 | T-M7-04 | On `409`, render each `conflicts[]` entry as a card titled by the memory, with side-by-side **ours** (target) / **theirs** (source) snapshots (`base/ours/theirs`, show "deleted here" when a side is null) plus a **manual-edit** textarea. User picks `"ours"`, `"theirs"`, or a hand-merged `{title,content}` per conflict; track resolved vs. unresolved and disable "Merge" until all are resolved. Resubmit `POST /api/mind/merge` with the same `source/target` + `resolutions:[{memory_id,resolution}]`; a further 409 re-renders remaining conflicts. |
| T-M7-06 | Memory history timeline | 2 | T-M6-08 | On a memory's detail sheet, a "History" toggle → `GET /api/memories/[id]/history`. List revisions newest-first: an **op badge** (create/update/delete, delete styled destructive), the commit `message` (fallback to the revision title), author label (you / agent `hv_…` / system) + timestamp, and a branch badge when the commit's branch differs from the current one. Loading + error states. |
| T-M7-07 | Revision diff view | 2 | T-M7-06 | Per revision (except the oldest), a "Diff" toggle → `GET /api/mind/diff?from=<older.commit>&to=<rev.commit>&memory_id=<id>`. Render hunks with `add`/`del`/`ctx` lines color-coded (add = green `+`, del = red `−`, ctx = muted). Handle `oversize` ("content replaced — too large to diff line by line") and empty hunks ("no content change — title or tags only"). |
| T-M7-08 | Restore / undelete | 1 | T-M7-06 | On any non-head, non-delete revision, "Restore this version" with a native destructive confirm. `POST /api/mind/revert` with `{ memory_id, revision_id, branch }`. On success revalidate — the restore lands as a **new commit** (history preserved), and undeletes a forgotten memory back onto the branch. Surface the returned `message`. |
| T-M7-09 | Time-travel (state at) | 2 | T-M7-01 | A "time-travel" entry point: pick a commit (from the log strip) or a date, then `GET /api/mind/state?at=<commit\|branch\|timestamp>&branch=`. Render the read-only snapshot — memories as of `at` (`title/summary/tags/source/committed_at`) plus link count — with a clear "viewing <at>" banner and a way back to live. Handle `400` (unparseable `at`). |
| T-M7-10 | Commit log strip | 1 | T-M7-01 | Under the branch switcher, "Latest commits on <branch>": `GET /api/mind/commits?branch=&limit=5` → short-hash (`id.slice(0,8)`) + truncated message + date per row. Tapping a commit feeds T-M7-09 (time-travel to that commit). Empty when the branch has no commits yet. |

## Out of scope / notes

- **No client-side merge** — all three-way merge logic is server-side
  (`/api/mind/merge`); the client only presents conflicts and posts resolutions
  (spec §7).
- **History is append-only:** restore/revert always creates a new commit; there
  is no destructive "rewrite" path to expose.
- **Branches recall lexically** (semantic recall is main-only, backend-side) —
  no client work; Search on a non-main branch simply reports `lexical` recall.
- **Connect / memory↔memory links are main-only** (see M6 T-M6-11) — the
  connect control is hidden on non-`main` branches.
- Full-graph diff (`GET /api/mind/diff` without `memory_id`) and a commit-graph
  visualization are **not** required here; scope is single-memory diffs plus the
  linear log strip.
- Deep-link `?branch=<name>` checkout is shared with M16 routing; this epic
  assumes the route param is available (M6 T-M6-01 plumbs it).
