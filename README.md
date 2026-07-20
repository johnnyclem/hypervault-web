# HyperVault

**Your personal flight deck for everything your AI creates.**

Quick, painless, permastorage for your AI artifacts: save anything an agent
makes with one command, get a permanent installable link, and claim a
legendary address like `you.vault.cool`.

## Try it now (5 minutes)

1. **Sign in** with Google at https://hypervault.store
2. **Save something**: open **My Vault → New from chat**, paste anything an AI
   made — a full HTML page *or* a bare React/JSX component (it gets detected
   and wrapped automatically). Optionally paste the **source prompt** that
   created it, so any AI that opens the link can pick up where you left off.
3. **Open the permanent link** (`/a/<slug>`) — share it, or hit
   "Add to Home Screen" on your phone to install it like an app.
4. **Claim your realm**: go to **Upgrade**, pick a name, and get
   `you.vault.cool` — live immediately. Pro accounts can claim up to 10
   subdomains across the portfolio, and your full vault lives on every one.
5. **Wire up your agents**: create an API key in the vault dashboard and run
   the [MCP server](mcp-server/README.md) so agents save artifacts for you.

## What's in this repo

| Path | What it is |
| --- | --- |
| `app/`, `components/`, `lib/` | The Next.js 15 web app (App Router + Tailwind + shadcn-style UI + Supabase) |
| `supabase/migrations/` | Database schema: profiles, artifacts, domain claims, API keys, memories, AgentVault secrets — with RLS |
| `mcp-server/` | `hypervault-mcp`, a Python FastMCP server so agents can save artifacts directly |
| `public/icons/` | PWA icons used by installable artifacts |
| `docs/mobile/` | Engineering spec + full PRD set for the native mobile client (iOS/Android) — on-device inference, BYO LLM, and full web/API/MCP parity |

## Native mobile client

The [`docs/mobile/`](docs/mobile/00-engineering-spec.md) folder is the
implementation handoff for a native app that reaches full parity with the web
app, the API, and the MCP tool surface — plus on-device / in-browser (WebLLM)
inference and power-user bring-your-own-LLM. Three API additions back it, all
authenticated the same way the rest of the API is:

- **`Authorization: Bearer <supabase-jwt>`** is now accepted everywhere
  `resolveApiIdentity` is (alongside `X-HyperVault-Key` and the web cookie), so
  a native app authenticates with its Supabase session — no API key required.
- **`GET /api/capabilities`** — one unauthenticated call returns the config a
  mobile client needs to bootstrap: feature flags, limits, the provider
  registry, the vanity portfolio, and the theme catalog.
- **`POST /api/chat/context` + `POST /api/chat/turns`** — split the chat
  pipeline so an on-device / WebLLM model can run inference locally while still
  using HyperVault's wiki recall, smart context, and memory-sync (context
  assembles, the model generates on device, turns persists).

## Feature map (per the PRD collection)

- **Core web app** — homepage with the flight-deck hero, `/upgrade` pricing +
  domain picker (vault.cool featured), `/vault` dashboard with list/graph
  toggle and "New from chat", Google sign-in via Supabase.
- **Raw artifact pages** — `GET /a/[slug]` is a route handler that returns the
  stored HTML byte-for-byte (no wrapper), with OG tags for social crawlers and
  PWA meta + manifest injected when the artifact opted in.
- **JSX auto-detect & wrap** — `POST /api/save` detects React/JSX output
  (Gemini-style bare components included), strips module syntax, and wraps it
  in the Babel Standalone + React CDN template with an Add-to-Home-Screen
  helper and a graceful error fallback (the original source is always
  viewable if rendering fails). One toggle forces plain HTML. 1 MB size limit.
- **Mutable artifacts — a living document agents can rewrite (iterations as git
  commits)** — artifacts are immutable by default (a save is permanent; re-saving
  identical content just hands back the existing link). Save one with
  `mutable: true` (web `POST /api/save` or MCP `save_to_hypervault`) and it
  becomes a living document: an agent reads its current source
  (`GET /api/artifacts/[slug]/content`, MCP `read_artifact`), writes a new
  iteration in place (`PUT …/content`, MCP `write_artifact`) — the URL never
  changes — and every write is kept as a **version**, a commit chained to the
  last one with full provenance (the agent key that wrote it). Browse the
  history like `git log` (`GET …/versions`, MCP `artifact_history`) and revert by
  reading an old version and writing it back. Writes are owner-scoped, so a
  mutable artifact is read/written privately even when the page itself is public;
  a no-op write (content identical to the head) records no commit. JSX is
  re-detected and re-wrapped on every write, just like on save. Schema in
  `supabase/migrations/0026_mutable_artifacts.sql` (adds `artifacts.mutable` and
  the `artifact_versions` table).
- **Fix a broken artifact** — when an artifact renders broken (an unbalanced
  brace, an unclosed tag, a stray token), a **🔧 Fix it** button on the vault
  card hands its source to whichever LLM backend you've connected and asks it
  to make the page render again. The remit is narrow — fix syntax, never
  finish a half-built feature; a stubbed-out handler beats a blank page
  (`POST /api/artifacts/[slug]/repair`, logic in `lib/repair.ts`). JSX
  artifacts repair their raw source and re-wrap; HTML artifacts repair in
  place. The served error fallback also carries an owner-only "Try an automatic
  repair →" deep link, so a broken page routes you straight to the fix.
- **Graph view + smart connections** — the `/vault` dashboard toggles between
  the list and an interactive force-directed graph (`react-force-graph-2d`):
  nodes colored by type, zoom/pan, click-to-open. Connections are
  bidirectional rows in the `connections` table — created manually
  (`connect_to` on save, the Connect button in the list, or
  `POST /api/connections`) or automatically from tag/title-keyword overlap
  when an artifact is saved.
- **Dreaming — nightly connection discovery (review like a PR)** — an opt-in
  background pass that finds connections you never made by hand. When enabled
  (`profiles.dreaming_enabled`), a nightly cron (`/api/cron/dreams`, scheduled
  in `vercel.json`) walks each user's vault and scores fresh candidate edges —
  artifact↔artifact, memory↔memory, and memory↔artifact — with the *same*
  tag/keyword-overlap heuristics the live graph already trusts, skipping any
  edge that already exists. Rather than mutate the graph, it stages the finds on
  a **"dreams branch"**: a staging area (`dream_connections`, grouped into
  `dream_runs`) that never touches the live graph until you say so. Review each
  night's run at **`/vault/dreams`** like a pull request — accept to merge an
  edge into the real graph (artifact pairs → `connections`, memory pairs → a
  commit on the wiki's main branch, bridges → `memory_artifact_links`), or
  reject to file it away for good (a rejected pair is never proposed again).
  "Dream now" (`POST /api/dreams/run`) triggers a pass on demand; the toggle
  lives at `PUT /api/dreams/settings`. Owner-only throughout (RLS), like
  memories. Schema in `supabase/migrations/0024_dreaming.sql`.
- **Digesting — split one memory into many (review like a PR)** — a big import
  or a pasted chat export often lands as a *single* memory when it's really
  several discrete thoughts. Where dreaming finds connections *between* items,
  digesting looks *inside* one item: it segments the content (chat turns,
  document sections, thematic breaks — deterministic heuristics, no LLM),
  proposes the pieces, and stages the split for review at **`/vault/digest`**
  like a pull request. Accept and the split applies as one `mind_commit` — a
  "rebase": the source memory is deleted and the segment memories are created in
  its place, wired together by *implicit links* (a sequence chain plus
  shared-theme edges), all atomic and revertible via the git-mind history.
  Reject and the memory is left whole. Trigger on demand with **Digest** on a
  memory card (`POST /api/digest/run`), or turn on auto-digest
  (`PUT /api/digest/settings`) to have splittable content propose itself as it's
  memorized. Owner-only throughout (RLS). Schema in
  `supabase/migrations/0025_digestion.sql`; details in
  [docs/digestion.md](docs/digestion.md).
- **Vanity domains** — middleware host-routing serves each portfolio domain's
  landing page at the root and `{name}.{domain}` as the user's public vault;
  unclaimed names show a friendly "still available" page. Claims via
  `POST /api/claim-domain` are effective immediately. The portfolio:
  `vault.cool` (featured), `agentvault.cloud`, `cleon.wiki`, `inkbound.ink`,
  `claudedamnit.com` (the meme one), `cleon.casa`, `cleon.city`,
  `tinderforai.com`, `onlywizards.website`, `hypervault.store`,
  `ralphy.website`, and `permaclaw.com`.
- **Source prompt for iterative building** — an optional "Source prompt" field
  on save (web form and MCP) is stored and baked into the page as
  `<meta name="hypervault-source-prompt">`, so any agent that opens the link
  can recover the original prompt and build on the artifact (PRD 6).
- **Imaging V3: export from any LLM + connect any backend** — import your full
  history from ChatGPT, Claude, Gemini, or Grok at `/vault/import` (official
  exports auto-detected, thread reconstruction included, paste fallback for
  mobile apps), connect any backend (OpenAI, Anthropic, xAI, Gemini, Mistral,
  Ollama, LM Studio, or a custom OpenAI-compatible endpoint — keys encrypted
  at rest), and chat at `/chat` with wiki recall pulling relevant vault
  artifacts into every turn. Conversations are stored in a canonical format,
  so you can start a thread in Claude and continue it in Grok with zero
  context loss. Details in [docs/imaging-v3.md](docs/imaging-v3.md).
- **Smart context & deep memory** — two on-by-default context engines for
  `/chat`, each with its own composer toggle. *Smart context* runs long
  thread histories through [short-hand](https://github.com/johnnyclem/short-hand)
  (vendored at `lib/vendor/short-hand`), progressively compacting older turns
  into standing facts, entities, topic summaries, and condensed lines — so a
  500-message thread keeps its early decisions in context without shipping
  every raw word. *Deep memory* queries a
  [stenographer](https://github.com/johnnyclem/stenographer) sidecar for
  GraphRAG recall across your entire conversation graph (decisions, people,
  topics from every chat, not just the open one); it appears automatically
  when the server sets `STENOGRAPHER_URL`, and both features degrade to
  today's exact behavior when off, unconfigured, or unreachable. Setup and
  architecture in [docs/chat-context.md](docs/chat-context.md).
- **Read replies aloud** — every completed assistant turn in `/chat` has a
  speaker button that synthesizes the reply with
  [Pocket TTS](https://huggingface.co/kyutai/pocket-tts) (Kyutai, CC-BY-4.0)
  running entirely in the browser via
  [pocket-tts-js](https://www.npmjs.com/package/pocket-tts-js) — the model
  (~125 MB) downloads once on first use and is cached offline; no audio API
  keys, nothing leaves the device.
- **Memory Control Panel (Imaging V2)** — every user gets a private
  LLM-wiki at `/vault/memory`: "Memorize this" stores a chunk with
  auto-title/tags/summary and links it into a knowledge graph
  (`memory_links`); natural-language recall (`GET /api/memories?q=`) merges
  Postgres full-text search with keyword scoring and returns exact chunks +
  linked context. Command-palette search (⌘K) in the dashboard. Memories are
  owner-only (RLS, no public reads) and reachable from agents via the MCP
  `memorize` / `recall` / `list_memories` / `forget_memory` tools (PRD 7).
- **Git for a Mind (PRD 8)** — the wiki is version-controlled like git:
  every memorize/edit/forget is a commit with provenance (you, or the agent
  key that wrote it). Branch your ideas (`?branch=` everywhere,
  `/api/mind/branches`), merge understanding back with three-way merge +
  conflict resolution (`/api/mind/merge`), diff any two branches, commits,
  or moments (`/api/mind/diff`), time-travel the whole wiki
  (`/api/mind/state?at=`), and revert/undelete without ever rewriting
  history (`/api/mind/revert`). Recall carries provenance receipts and
  upgrades to hybrid semantic search (pgvector) when an OpenAI backend is
  connected — falling back to lexical otherwise. Agents get the full kit:
  `edit_memory`, `memory_history`, `mind_log`, `mind_branch`, `mind_diff`,
  `mind_merge`, `mind_revert`, `mind_state`. Details in
  [docs/prd-8-git-mind.md](docs/prd-8-git-mind.md).
- **MCP server** — `save_to_hypervault` (with `source_prompt` and `mutable`
  support), `claim_vanity_subdomain`, `list_my_vault_items`,
  `connect_vault_items`, `read_artifact` / `write_artifact` / `artifact_history`
  (read, rewrite, and browse the git-commit history of a mutable artifact),
  `extract_source_prompt` (pulls the source prompt back out of any artifact
  URL), and a `hypervault://help` resource, authenticated with
  `X-HyperVault-Key` (created in the dashboard, rate-limited, stored as
  SHA-256 hashes). STDIO and HTTP transports.
- **Polytician backend** — HyperVault speaks
  [Polytician](https://github.com/johnnyclem/polytician)'s AgentVault REST
  contract, so a Polytician MCP server can sync its concepts into the versioned
  wiki with only config: point its `apiBaseUrl` at this deployment and
  `apiToken` at an `hv_` key (Bearer auth is accepted alongside
  `X-HyperVault-Key`). Optionally set `POLYTICIAN_SIDECAR_URL` to rerank lexical
  recall with Polytician's local embeddings. Details in
  [docs/polytician.md](docs/polytician.md).
- **AgentVault secrets** — an opt-in, named secret store for agent credentials
  (`user_secrets`, migration `0023_agent_vault.sql`). Create encrypted secrets in
  the vault dashboard, then grant a specific API key read access to a specific
  secret — a granted key fetches the value from `GET /api/secrets/:name`, while
  ungranted keys and session identities are refused. MCP servers can point their
  auth at a vault secret instead of an inline cipher (`*_secret_id` columns);
  `resolveServerAuth` dereferences the reference transparently, so every consumer
  (add / refresh / compile / runtime dispatch) inherits vault-backed auth for
  free, and an OAuth refresh rotates the value in place inside the vault. Values
  are encrypted at rest with the same `HYPERVAULT_KEY_SECRET`-derived key as
  backend keys and never leave the server.

## Local development

```bash
cp .env.example .env.local   # fill in Supabase credentials
npm install
npm run dev
```

1. Create a Supabase project, enable the **Google** auth provider, and run
   the files in `supabase/migrations/` in order (SQL editor or
   `supabase db push`).
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
3. Visit `http://localhost:3000`, sign in, and generate an agent API key from
   the vault dashboard to use with the MCP server.

Public pages (`/`, `/upgrade`, `/cool`) render without Supabase configured, so
you can preview the UI before wiring up a backend.

Run the unit tests (JSX detection/wrapping, meta injection, domain
validation) with:

```bash
npm test
```

## Deploying

- **Vercel:** import the repo, set the env vars from `.env.example`, done.
- **Domains:** point `hypervault.store` (or `.app`) at the project, plus each
  portfolio domain **and** its wildcard (e.g. `vault.cool` + `*.vault.cool`,
  `cleon.wiki` + `*.cleon.wiki`) — the middleware routes hosts, so the
  wildcard record is all a new claim needs to work instantly. Set
  `NEXT_PUBLIC_VANITY_DOMAINS` to the domains this deployment actually serves.
- Set `NEXT_PUBLIC_APP_URL` to the canonical origin so artifact URLs and OG
  tags are correct.

## MCP server

See [`mcp-server/README.md`](mcp-server/README.md). TL;DR:

```bash
cd mcp-server && pip install -e .
export HYPERVAULT_API_KEY=hv_...
hypervault-mcp
```

Running your agent inside a [greywall](https://github.com/johnnyclem/greywall)
sandbox? The server is single-host by design, so one allowed domain covers
every tool — see [docs/greywall.md](docs/greywall.md).
