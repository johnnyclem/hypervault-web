# M6 — Memory Wiki (Imaging V2)

**Status:** Draft for implementation handoff · **Epic:** M6 · **Depends:** M2 (auth) · M4 (graph, for Graph mode) · M8 (chat, for Ask mode)

> Read [`../00-engineering-spec.md`](../00-engineering-spec.md) and
> [`00-index.md`](./00-index.md) first. Every endpoint used here is defined in
> [`api-contract.md`](./api-contract.md). Conventions (auth header, error
> toasts, loading/empty states, optimistic+revalidate, native confirms, limits
> from `GET /api/capabilities`, theming + a11y) are inherited from the index and
> not repeated per task.

## Goal

Bring the full **Memory Control Panel** (the private, per-user LLM-wiki) to the
phone: one screen with **Search / Ask / Graph** modes over the user's memories.
Recall a memory by meaning or keyword, memorize a chunk, import a file or URL,
open a page to read its content + provenance + links, edit it, forget it, and
connect it to other memories or vault artifacts — everything the web
`/vault/memory` panel does, minus the browser-only ⌘K palette (replaced by a
native global-search affordance per spec §9). Git-mind versioning (branches,
history, merge, diff, time-travel) is layered on in [M7](./07-git-mind.md); this
epic threads the active `branch` through every call but ships branch-`main`
behavior end to end.

## User stories

- As a user, I open Memory and instantly filter my wiki as I type; a beat later
  the server's hybrid (semantic + keyword) recall takes over and I can tell
  which kind of recall answered me.
- As a user, I paste a chunk worth keeping and memorize it; it comes back
  auto-titled, summarized, and tagged.
- As a user, I import a PDF/DOCX/Markdown file, or paste a GitHub repo / article
  URL, and it lands in my wiki as a memory.
- As a user, I tap a memory to read its full content, see the commit that last
  touched it and how many revisions it has, jump to linked memories, and open
  linked artifacts.
- As a user, I edit or forget a memory, and I connect one memory to another
  memory or to a vault artifact.
- As a user, I switch to Ask and chat with my wiki — answers cite the memories
  they were grounded in, and I can save an answer back to my vault.
- As a user, I switch to Graph and see my memories, their links, and the
  artifacts they bridge to, tapping any node to open it.
- As a user, a deep link (`?open=<id>` / `hypervault://…`) drops me straight
  onto a memory page.

## Tasks

| ID | Title | Pts | Depends | Description / Acceptance |
| --- | --- | --- | --- | --- |
| T-M6-01 | Memory screen shell + mode control | 2 | T-M2-* , T-M1-* | Memory route with a segmented control **Search / Ask / Graph** (native tab bar / `SegmentedControl`, mirrors the web `mode` tabs). Holds the active `branch` (default `main`, from route param — see M7) and threads it into every call as `?branch=` / body `branch` (omit or send `main` for default). Loading/empty/error states. Header shows memory count ("N memories in your wiki"). |
| T-M6-02 | Search — instant local filter | 1 | T-M6-01 | With a query typed, filter the loaded memory list client-side immediately (title/summary/tags/source substring rank, mirroring web `scoreRecall`) so results feel instant before the network responds. Empty query shows the full list. |
| T-M6-03 | Search — debounced server recall | 2 | T-M6-02 | Debounce ~300 ms (query ≥ 2 chars), then `GET /api/memories?q=&branch=`; when `results[]` returns, it replaces the local filter. Show `recall_mode`: `hybrid` → "semantic + keyword recall", `lexical` → "keyword recall"; show live "recalling…" while in flight and a match count ("N matches"). Abort the in-flight request when the query changes. On offline/error, keep the local filter and surface the error inline. |
| T-M6-04 | Memory card list | 1 | T-M6-01 | Render each memory as a card: title, date, summary, a `source` badge, up to 6 tag badges, and a link-count badge. Tap opens the detail sheet (T-M6-06). Empty state: "Your wiki is empty — memorize your first chunk, or let your agents do it via MCP." |
| T-M6-05 | Memorize | 2 | T-M6-01 | A "Memorize / import" affordance revealing a compose sheet. `POST /api/memories` with `{ content, source:"chat", branch? }`. Enforce the `memory_bytes` (500 kB) cap from capabilities **client-side before POST**; show the byte count and block over-limit with a clear message (also handle a server `413`). On success, clear the draft, show the returned `message`, and revalidate the list. |
| T-M6-06 | Import a file | 2 | T-M6-05 | `expo-document-picker` (accept PDF/DOCX/`.md`/`.markdown`/`.mdx`/`.txt`), pre-check `file.size` against the `import_bytes` (50 MB) cap and refuse over-limit before upload (Vercel returns a plain-text 413 otherwise). Multipart `POST /api/memories/import?branch=` with the `file` part via `expo-file-system`. Show "Importing file…" progress; on success show `message` and revalidate. Handle 413/415/429/503. |
| T-M6-07 | Import a URL | 1 | T-M6-05 | Text field + button: `POST /api/memories/import?branch=` with JSON `{ url }` (Content-Type application/json). Copy: GitHub repo → project digest, any other page → scraped knowledgebase entry. Disable while importing; on success clear + revalidate. Same error handling as T-M6-06 (12/min rate limit → surface the 429 text). |
| T-M6-08 | Memory detail sheet | 2 | T-M6-04 | `GET /api/memories/[id]?branch=` → render `memory.content` (monospace, scrollable), the `provenance` receipt line ("Last commit `abc12345` · message · by you/agent `hv_…`/system · time · N revisions" from `revision_count`), a **Linked memories** list (tap → open that memory), and a **Linked artifacts** list (open `/a/[slug]` in a WebView / share). Loading + error states. |
| T-M6-09 | Edit a memory | 2 | T-M6-08 | From the detail sheet, "Edit" pre-fills title + content. `PATCH /api/memories/[id]` with `{ title, content, branch }`. Enforce the 500 kB cap client-side; handle `400` ("nothing changed") and `413`. On success show `message`, close, and revalidate (the edit lands as a git-mind commit). |
| T-M6-10 | Forget a memory | 1 | T-M6-08 | "Forget" with a native destructive confirm (mirrors web tap-to-confirm "Really forget?"). `DELETE /api/memories/[id]?branch=`. Optimistically remove from the list and close the sheet; roll back + show the error on failure. |
| T-M6-11 | Connect a memory | 2 | T-M6-08 | "Connect" picker offering other **memories** and vault **artifacts** as targets. `POST /api/connections` with `{ source: memory.id, target }` (id/title of a memory or id/slug/title of an artifact). **Only on branch `main`** — hide the control on other branches (memory↔memory links commit to main). On success, reload the detail (new link shows) and revalidate. Handle 400/404. |
| T-M6-12 | Ask mode — grounded chat | 2 | T-M6-01 , T-M8-* | Reuse the M8 chat surface scoped to the wiki: each turn `POST /api/chat` with `{ backend_id, message, conversation_id?, use_recall:true }`. Render the thread; under each assistant reply show **"Grounded in:"** the `recalled_memories` titles and the `model`. Backend picker when > 1 backend; empty state when no backend is connected (deep-link to M10 "connect a backend"). Persist `conversation_id` across turns. |
| T-M6-13 | Save-to-vault under answers | 1 | T-M6-12 , T-M3-* | Under each Ask answer, a "Save to vault" action (reuse the M3 save flow → `POST /api/save`) that persists the reply as an artifact, passing the prior user turn as `source_prompt` and tag `memories`. Success/toast + optimistic vault update. |
| T-M6-14 | Graph mode | 1 | T-M6-01 , T-M4-* | Reuse the M4 vault graph rendered over **memories**: memory nodes, their `memory_links` (manual/auto edges), and only the artifacts that actually bridge into the wiki (`memory_artifact_links`) as neighbor nodes. Tap a memory node → switch to Search mode and open that memory's detail. Honor the 150-node/kind cap and reduced-motion. |
| T-M6-15 | Global search affordance (⌘K replacement) | 1 | T-M6-01 | Replace the browser ⌘K palette (spec §9) with a native global-search entry point (nav search icon / pull-down) reachable from anywhere in the app that lands in Memory → Search with the field focused. No physical-keyboard shortcut required. |
| T-M6-16 | Deep-link to a memory | 1 | T-M6-08 , T-M16-* | Handle `?open=<id>` (universal link + `hypervault://` route) by opening Memory in Search mode and loading that memory's detail on mount (mirrors web `initialOpenId`). If the id 404s, land on the list with the error toast. |

## Out of scope / notes

- **Branch UI, history, diff, merge, revert, time-travel, commit log** are
  [M7](./07-git-mind.md); this epic only *carries* `branch` through the calls.
- **No client-side merge for memories** — conflicts round-trip to
  `/api/mind/merge` (M7), per spec §7.
- Ask mode is **remote-backend chat** (`POST /api/chat`); on-device/WebLLM chat
  lives in M9 and is not required here.
- The memory list is capped at 200 rows by the API; server recall (T-M6-03) can
  surface memories beyond the loaded page — trust `results[]` over the local set.
- Import file types and both import shapes (multipart `file` vs JSON `{url}`)
  hit the **same** `POST /api/memories/import` route; only the body differs.
