# Digesting — split one memory into many

## The problem

A memory doesn't always arrive as one thought. When you import a full history
from another chat provider, paste a long transcript, or memorize a multi-section
document, it lands in the wiki as a *single* memory — one title, one summary,
one node in the graph — even though it's really a dozen discrete ideas wearing a
trench coat. Recall suffers (one giant chunk matches everything and nothing), the
graph is coarse (one node where there should be many), and the pieces can never
link to the rest of your vault on their own terms.

**Digesting** fixes that. It evaluates a single piece of content, proposes how to
break it into individual memories, and — once you approve — rewrites the one
memory into the pieces, wired together by implicit links. Think of it as the
inside-out complement to [dreaming](../README.md): dreaming discovers
connections *between* items across the whole vault; digesting discovers the
seams *within* one item.

## The model — a rebase for a mind

Digesting mirrors dreaming's "review like a pull request" shape, and it leans on
[Git for a Mind](prd-8-git-mind.md) to make the split safe.

1. **Segment** (pure, no LLM). `segmentContent()` in [`lib/digestion.ts`](../lib/digestion.ts)
   reads the content and finds its natural seams, trying three strategies in order:
   - **chat** — speaker markers at the start of a line (`User:`, `**Assistant**:`,
     `### Human`, `Claude:`, `> AI —`, …). Each turn becomes a piece. This is the
     flagship case: an exported transcript becomes one memory per turn.
   - **headings** — top-level markdown headings (`#` … `######`). Each section
     becomes a piece; nested subsections ride inside their parent.
   - **rules** — thematic breaks (`---`, `***`, `___`) between blocks.

   If none of these yields at least two pieces, the content reads as a single
   thought and **nothing is proposed**. Tiny fragments are merged into a
   neighbor (no confetti memories), and the whole thing is capped at
   `MAX_SEGMENTS` by merging the shortest adjacent pieces — a split **never drops
   content**, so the entire source always survives.

   Each piece is titled, tagged, and summarized with the same heuristics
   `POST /api/memories` already uses (`autoTitle` / `autoTags` / `summarize`), so
   a segment memory is indistinguishable from one you'd have memorized by hand.

2. **Implicit links.** `internalLinks()` computes the edges that will wire the
   pieces together — the "implicit links (like a git rebase)" of the ask:
   - **sequence** — every adjacent pair (0–1, 1–2, …), preserving the original
     reading order of the one continuous memory.
   - **theme** — any *non-adjacent* pair that shares a tag or ≥ 2 keywords,
     surfacing an echo the content makes with itself.

3. **Stage.** `generateDigestForMemory()` records the proposal as a pending
   `digest_run` plus its `digest_segments` (each carrying the `new_memory_id`
   it will become, so preview and result line up exactly). It's idempotent per
   source — a memory that already has a pending digest returns that one instead
   of stacking duplicates (enforced by a partial unique index).

4. **Review & apply.** At `/vault/digest` you see each proposal like an open PR:
   the source title, the pieces (title · why · summary · tags), and a note about
   the implicit links. **Apply split** runs `applyDigest()`, which commits the
   whole rewrite in **one** `mind_commit`:
   - the source memory is **deleted**, and
   - the segment memories are **created** in its place, with the sequence and
     theme links added — all in the same commit.

   Because it's a single commit, the split **time-travels and reverts
   atomically** (`/api/mind/revert`), exactly like undoing a rebase. Segments
   inherit the source's `source` value, so provenance carries through. **Keep
   whole** just dismisses the proposal; the memory is untouched.

## Triggering a digest

- **On demand** — the **Digest** button on a memory's card in the Memory Control
  Panel, or `POST /api/digest/run` with `{ "memoryId": "…", "branch": "…"? }`.
  Agents authenticate the same way as every other API surface
  (`X-HyperVault-Key` or `Authorization: Bearer`), so this works from the MCP
  side too.
- **Automatically** — turn on **Auto-digest on import**
  (`PUT /api/digest/settings` `{ "enabled": true }`). Then any chunk that looks
  splittable stages a proposal for review as it's memorized. It's off by default
  and purely additive: a hiccup while proposing never fails the memorize.

Everything is owner-only (RLS), like memories and dreaming.

## API surface

| Route | What it does |
| --- | --- |
| `POST /api/digest/run` | Stage a digest proposal for one memory (`{ memoryId, branch? }`). Returns `run_id: null` when there's no natural split. |
| `GET /api/digest` | The review queue: pending runs, their proposed segments, and the implicit-link preview. |
| `POST /api/digest` | Decide a run: `{ decision: "accept" \| "reject", runId }`. Accept applies the split as one commit; reject dismisses it. |
| `GET` / `PUT /api/digest/settings` | Read / set the auto-digest toggle (`{ enabled }`). |

## Schema

[`supabase/migrations/0025_digestion.sql`](../supabase/migrations/0025_digestion.sql):

- `profiles.digestion_enabled` — the auto-digest opt-in (default `false`).
- `digest_runs` — one proposal per source memory: `source_memory_id`,
  `branch_id`, `source_title`, `strategy`, `segment_count`, `status`
  (`pending` → `applied` / `rejected`). A partial unique index keeps at most one
  open run per source.
- `digest_segments` — the proposed pieces, ordered by `ordinal`, each with the
  `new_memory_id` it will become on apply.

Reads degrade gracefully on a pre-0025 database (the badge and toggle simply
hide); a *write* against the missing schema returns the standard one-migration
hint (`missingDigestionSchemaHint` in [`lib/supabase/errors.ts`](../lib/supabase/errors.ts)).

## Why deterministic segmentation

The segmentation is pure heuristics, not an LLM call — the same choice dreaming
makes for connection discovery. It's fast, free, unit-testable
([`lib/__tests__/digestion.test.ts`](../lib/__tests__/digestion.test.ts)), works
with no backend connected, and its splits are never weirder than the structure
already present in the text. Chat exports and markdown documents — the content
that actually gets over-compressed on import — carry exactly the structural
markers this keys off. An LLM-assisted "smart digest" could layer on later behind
a connected backend, the way recall upgrades to hybrid semantic search, without
changing this contract.
