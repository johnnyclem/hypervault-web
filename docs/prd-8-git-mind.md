# PRD 8 — Git for a Mind: Versioned, Branchable Memory

## Goal

Make the memory wiki (PRD 7) a true "git for a mind": **version your
thoughts, branch your ideas, merge understanding, diff and time-travel your
memory graph, and back every recall with provenance.** Every memory write
becomes a commit; nothing is ever silently lost; agents and the web UI share
the same versioned substrate.

Storage is Postgres-native in Supabase (commit/revision/branch tables with
owner-only RLS) — no literal git repositories.

## Claim → feature map

| Promise | HyperVault feature |
| --- | --- |
| **Version your thoughts** | Every memorize/edit/forget is a commit (`memory_commits` + full-snapshot `memory_revisions`). New `PATCH /api/memories/[id]` edit endpoint and `GET /api/memories/[id]/history` — the PRD-7 "versioned wiki pages" cut, shipped. |
| **Branch your ideas** | `memory_branches` with cheap head-pointer forking (`POST /api/mind/branches`); every memory API takes `?branch=`. `public.memories` stays the live state of `main`, so existing readers never changed. |
| **Merge understanding** | Three-way merge from the common ancestor (`POST /api/mind/merge`): one-side changes auto-merge, both-sides-diverged returns 409 with base/ours/theirs + hunks for resolution ("ours" / "theirs" / hand-merged). Links merge set-wise, never conflict. |
| **Diff a mind** | `GET /api/mind/diff?from=&to=` — memories added/changed/removed with line hunks (jsdiff), links added/removed; `&memory_id=` scopes to one page. Refs are branch names, commit ids, or timestamps. |
| **Time-travel** | `GET /api/mind/state?at=<commit\|timestamp>` replays first-parent ancestry (`mind_state_at` / `mind_links_at`); `POST /api/mind/revert` restores an old revision — or undeletes — as a NEW commit. History is never rewritten. |
| **Provenance-backed recall** | Commits record the author: you (session), an agent (its API-key id → shown as the `hv_…` prefix), or system. Every recall result carries a `provenance` receipt (commit, message, author, time). |
| **Embedding recall** *(PRD-7 cut)* | pgvector `embedding vector(1536)` on `memories` + `mind_semantic_recall`; populated best-effort (≤1.5 s, failures swallowed) via the user's own connected OpenAI backend. Recall fuses semantic + lexical rankings (reciprocal-rank fusion) behind the same `GET /api/memories?q=` and reports `recall_mode: "hybrid" \| "lexical"`. No backend → byte-identical lexical behavior. |
| **Auto-pruning / roll-ups** *(PRD-7 cut)* | **Deferred, design-mapped**: a roll-up is an ordinary `system`-authored commit creating a summary memory (tag `rollup`) linked to its constituents — the `author_kind='system'` enum ships now; the scheduler/heuristics do not. |

## User story

> I branch my wiki to `research/quantum`, let an agent fill it with fifty
> speculative memories over a week, and skim `mind_diff main research/quantum`
> before deciding. Two memories conflict with edits I made on main — the merge
> shows me both versions side by side, I pick and hand-merge, and the merge
> commit lands with full provenance. A month later I run
> `mind_state at="2026-06-13"` and see exactly what my mind knew back then.

## Architecture

- **`public.memories` is the live, materialized state of `main`** — recall,
  chat injection, and the dashboard read it exactly as before. The version
  layer wraps it; `public.mind_commit` (the single transactional write
  primitive) mirrors default-branch changes into it. **Never write
  `memories`/`memory_links` directly from app code.**
- **Tables** (`0009_git_mind.sql`, owner-only RLS): `memory_branches` (refs),
  `memory_commits` (the DAG: `parent_commit_id` + `merge_parent_commit_id`),
  `memory_revisions` (full snapshots, own weighted tsvector so FTS works on
  branches), `memory_heads` (materialized branch state — hot reads never
  replay), `memory_link_changes` (edge history). `memory_links` gained
  `branch_id` and dropped its FKs to `memories`.
- **Logical identity**: `memory_id` is shared across branches; on main it
  equals `memories.id`.
- **Branching** copies head pointers + link rows only (ids, no content) and
  starts the fork's head at the source's head commit, so ancestry — and with
  it merge-base and time-travel — crosses fork points like git.
- **Merging** is pure TypeScript (`lib/mind/merge.ts`): BFS merge-base over
  both parents, field-level three-way classification per memory, set-wise
  link merge. The merge commit materializes everything taken from theirs, so
  first-parent replay stays exact.
- **Genesis backfill**: migration 0009 gives every user with memories a
  `main` branch and a system "genesis" commit snapshotting the wiki, so
  history starts coherent.

## Surfaces

- **API**: `?branch=` on `GET/POST /api/memories`, `GET/PATCH/DELETE
  /api/memories/[id]`, `POST /api/memories/import`; new
  `GET /api/memories/[id]/history`, `GET/POST /api/mind/branches`,
  `DELETE /api/mind/branches/[name]`, `GET /api/mind/commits`,
  `GET /api/mind/diff`, `POST /api/mind/merge`, `GET /api/mind/state`,
  `POST /api/mind/revert`.
- **MCP** (`mcp-server/`): existing memory tools take `branch=`; new
  `edit_memory`, `memory_history`, `mind_log`, `mind_branches`,
  `mind_branch`, `mind_diff`, `mind_merge`, `mind_revert`, `mind_state`.
- **UI** (`/vault/memory`): branch switcher chips (+ fork, merge-into-main,
  delete), latest-commits strip, per-memory Edit (commits an update),
  History timeline with revision diffs and restore, provenance line on every
  open page, merge dialog with side-by-side conflict resolution.

## Constraints & decisions

- **No LLM in the hot path** (PRD 7) still holds: versioning is pure
  Postgres + heuristics; embeddings are opportunistic via the user's own
  backend and everything degrades to lexical.
- Revisions store **full snapshots** (≤500 kB each) — simple and
  time-travel-fast at personal scale; content-hash dedup is a future
  optimization.
- Branch writes are serialized per branch (`for update` lock) with an
  optional stale-head guard; merges pass it.
- Deleting a branch that other branches were forked from is refused (FK) —
  delete or merge the children first.

## Still to polish (known, deliberate cuts)

- Roll-up/auto-pruning execution (mapped above; needs a scheduler).
- Artifact versioning (memories only for now).
- Commit-graph visualization (the force-graph exists for artifacts).
- Semantic recall on non-main branches (branches recall lexically).
- Branch selection for chat recall (`lib/recall.ts` reads main).

## Definition of done

- [x] Every memory write path (store, edit, import, forget) records a commit
      with provenance; genesis backfill covers existing wikis.
- [x] Branch → edit → merge → conflict → resolve round-trip works via API,
      MCP, and the dashboard.
- [x] Diff and time-travel reproduce prior states exactly (unit-tested
      replay/merge/diff mirrors of the SQL).
- [x] Hybrid recall behind the same API with graceful lexical fallback.
- [x] `npm test` covers merge-base, three-way merge, resolutions, link
      merge, hunk/state/link diffs, and first-parent replay; app typechecks
      and builds.
