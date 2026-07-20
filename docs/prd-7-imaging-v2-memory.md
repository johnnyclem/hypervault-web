# PRD 7 — Imaging V2: Memory Control Panel + Per-User LLM-Wiki

## Goal

Give every user a private, Karpathy-style personal memory system: long-term
context that grows with them, not just session tokens. Behind a clean
store/recall dashboard (the **Memory Control Panel**, `/vault/memory`) sits a
text + knowledge-graph hybrid wiki that agents read and write over MCP.

## User story

> While pairing with Claude I hit a subtle Rust borrow-checker gotcha and say
> "remember this." A month later, in a fresh session with a different agent,
> I ask "what did I say about the Rust borrow checker last month?" — recall
> returns the exact chunk, its summary, and the related memories it linked
> to, so the agent picks up right where past-me left off.

## Acceptance criteria

- [x] **Store** — `POST /api/memories` ("Memorize this"): auto-title,
      auto-tags, auto-summary, and automatic knowledge-graph linking to
      related memories via tag/keyword overlap (`memory_links`,
      normalized bidirectional pairs like artifact connections).
- [x] **Recall** — `GET /api/memories?q=` accepts natural-language queries
      and merges Postgres full-text search (websearch syntax over a weighted
      `tsvector`) with keyword relevance scoring. Top matches return the
      exact stored chunk; the long tail returns summaries; every match lists
      its linked memories.
- [x] **Wiki view** — `/vault/memory` is a browsable, searchable dashboard:
      command-palette-style search (⌘K), instant client-side filtering with
      the same scoring the backend uses, expandable memory pages showing the
      full chunk and linked memories, one-click memorize and forget.
- [x] **MCP tools** — `memorize`, `recall`, `list_memories`,
      `forget_memory`, documented in the `hypervault://help` resource, using
      the same `X-HyperVault-Key` auth as the rest of the server.
- [x] **Privacy** — memories are owner-only end to end: RLS allows no public
      reads, no public page ever renders them, and data leaves the account
      only if the user explicitly exports it.
- [x] Unit tests for the heuristics (tagging, titling, summarizing, recall
      scoring, link suggestion).

## Constraints & decisions

- **No LLM in the hot path.** Tagging, summarizing, and linking are
  deterministic heuristics (frequency-ranked keywords, leading sentences,
  overlap scoring) — the same MVP approach the artifact graph uses. An
  embedding/LLM upgrade can slot in behind the same API later.
- **Recall latency at scale:** summaries carry the result list and full
  content ships only for the top 3 matches, so recalls over large wikis stay
  light. Full-text search runs on a weighted, GIN-indexed generated column
  (title A, summary/tags B, content C).
- **Size limit:** 500 kB per memory. Bigger chunks should be split — recall
  works on chunks, not archives.
- **Sources** are constrained to `manual | chat | coding | agent` so the wiki
  can filter by provenance later.

## Still to polish (known, deliberate cuts)

- Auto-pruning tiers / hierarchical roll-up summaries for wikis beyond ~10k
  memories.
- Embedding-based recall (pgvector) behind the same recall API.
- Versioned wiki pages (edit history per memory).

## Definition of done

- [x] Store → recall round-trip works via web UI and MCP.
- [x] Auto-links appear between related memories and surface in recall and
      the wiki view.
- [x] `npm test` covers the heuristics; app typechecks and builds.
