# Polytician Integration — HyperVault as a first-class concept backend

## Goal

Make [Polytician](https://github.com/johnnyclem/polytician) — a local-first MCP
semantic-memory server that stores "concepts" as interchangeable vector /
markdown / **ThoughtForm** representations — sync into HyperVault's versioned
memory wiki with **only configuration, no code changes on either side.**

Polytician already ships a complete external-platform integration
(`src/integrations/agent-vault/`) built around the six-endpoint REST contract in
its `AGENTVAULT_COMPATIBILITY_PRD.md`. HyperVault implements that contract,
mapped onto machinery it already has — **Git for a Mind** for the memory repo,
`sendChat` for inference, artifact permastorage for archival. Point Polytician's
AgentVault config at a HyperVault deployment and its `MemorySyncConnector` +
`vault_*` MCP tools light up against it.

The integration is bidirectional:

- **Polytician → HyperVault** (the bridge): concepts become versioned, provenance-stamped memories.
- **HyperVault → Polytician** (interop): ThoughtForm import/export, plus an optional local embedding reranker.

## Claim → feature map

| AgentVault endpoint | HyperVault route | Mapped onto |
| --- | --- | --- |
| `GET /api/memory-repo/branches/:branch` | `app/api/memory-repo/branches/[branch]/route.ts` | Branch state (`mind_branch_state`) + stored ThoughtForms, as keyed entries. Auto-forks `polytician-main` from `main` on first touch. |
| `POST /api/memory-repo/commits` | `app/api/memory-repo/commits/route.ts` | One `mind_commit` for the batch (agent-authored, provenance-stamped); ThoughtForm attached in `polytician_concepts`. |
| `POST /api/memory-repo/tombstone` | `app/api/memory-repo/tombstone/route.ts` | A `delete` commit (recoverable via `mind_revert` / `mind_state`) for markdown; nulls the stored ThoughtForm for the json key. |
| `POST /api/inference` | `app/api/inference/route.ts` | `sendChat` over the caller's connected `llm_backends` (most-recently-used, or a local backend when `preferredBackend:"local"`). |
| `POST /api/archival/upload` | `app/api/archival/upload/route.ts` | Artifact permastorage (`saveArtifactCore`) — a permanent `/a/<slug>` link is the receipt (`txId = slug`). |
| `GET /api/secrets/:name` | `app/api/secrets/[name]/route.ts` | AgentVault secret read, gated by a per-key ACL (see deviations). Returns `{ name, kind, value }` only to an API key granted access to that secret. |

Auth: Polytician sends `Authorization: Bearer <token>`. `resolveApiIdentity`
(`lib/api-auth.ts`) now accepts a `Bearer hv_…` token as an API key in addition
to the `X-HyperVault-Key` header. Bridge routes raise the per-key rate limit to
240/min (`BRIDGE_RATE_LIMIT`) so a bulk initial sync doesn't 429.

Data: migration `0019_polytician_bridge.sql` adds `public.polytician_concepts`
(concept id ⇄ memory id, namespace/version, latest ThoughtForm JSON, and the
last-write-wins `updated_at_ms` clock). Markdown stays the versioned source of
truth in the mind tables; this table only carries what a concept needs to
round-trip.

## Setup (point Polytician at HyperVault)

1. In HyperVault, create an API key (`hv_…`) from your vault dashboard (or `POST /api/keys`).
2. In Polytician, configure its AgentVault integration — `.polytician.json` or env:
   ```json
   {
     "agentVault": {
       "apiBaseUrl": "https://your-hypervault-deployment",
       "apiToken": "${POLYTICIAN_AV_API_TOKEN}",
       "memoryRepo": { "branch": "polytician-main" }
     }
   }
   ```
   (or `POLYTICIAN_AV_API_URL` / `POLYTICIAN_AV_API_TOKEN`).
3. From Polytician, `save_concept` then `vault_memory_push` — the concept appears
   as a memory on `polytician-main`.
4. Verify: `GET /api/mind/commits?branch=polytician-main` shows the commit with
   `author_kind: "agent"` and your key prefix; the wiki UI at `/vault/memory`
   shows it in history. Merge it into everyday recall with
   `POST /api/mind/merge` (`source: "polytician-main"`, `target: "main"`).

Concepts keep their Polytician ids: a UUID id maps to itself; any other id folds
to a deterministic UUID (`conceptIdToMemoryId`), and the verbatim id is stored so
branch-state export rebuilds keys exactly.

## Importing an export

`POST /api/memories/import` also accepts a Polytician concept/bundle export
(`{ concepts: [...] }` or a bare array). Each concept is committed as a memory in
one batch, with its ThoughtForm attached. The importer
(`lib/polytician/import.ts`) is forgiving about shape (`representations`,
`markdown`/`md`/`text`, bare ThoughtForm objects).

Export the other way with `GET /api/memories?format=thoughtform` — each memory
carries its stored ThoughtForm, or one synthesized on the fly from its tags and
graph links (`lib/polytician/thoughtform.ts`).

## Local reranker (HyperVault → Polytician)

Polytician's Python sidecar exposes `/embed` but **no concept-search endpoint**
(search is MCP-stdio only), so HyperVault can't query Polytician's store over
HTTP today. What it can do: borrow the sidecar's local embeddings to rerank
HyperVault's own lexical wiki recall when the user has no cloud embedding backend
(recall would otherwise stay lexical-only).

Set `POLYTICIAN_SIDECAR_URL` to the sidecar's base URL. In chat, recall then
reports `recall_mode: "hybrid-local"`. It's a per-user toggle
(`profiles.chat_polytician`, migration `0020_polytician_settings.sql`, default
ON) with a per-request `use_polytician` override on `POST /api/chat`, mirroring
the deep-memory toggle. No 384-dim vectors are stored, so there's no clash with
the wiki's `vector(1536)` embeddings.

## Deviations from the AgentVault PRD

These are grounded in Polytician's *actual* client behavior (`AVHttpClient`):

- **Tombstone returns `200` with a JSON body, not `204`.** Polytician's client
  calls `res.json()` on every response and would crash on an empty body.
- **Invalid keys return `401`, not `403`.** The client treats all non-2xx
  responses generically, so this is transparent.
- **`temperature` on `/api/inference` is accepted but ignored** (`sendChat`
  doesn't plumb it).
- **`/api/secrets/:name` is now implemented as an opt-in AgentVault store, not a
  blanket `501`.** The original stub refused all reads because returning key
  material to any `hv_` API-key holder would silently escalate what a key grants.
  That risk is now addressed by a per-key ACL (`secret_grants`): the endpoint
  returns a value **only** to an API-key identity that has been explicitly
  granted access to the named secret (`user_secrets`). Defaults stay safe —
  a session/JWT identity is refused (`403`), and an ungranted key gets `404`
  (never revealing that the secret exists). Secrets are created and granted
  through the human-authed manager at `/api/secrets` (see
  `0023_agent_vault.sql`). Polytician's own `vault_get_secret` tool remains
  metadata-only, so this endpoint is used only by keys you opt in.
- **Archival receipts are `/a/<slug>` links, not Arweave transactions.** A real
  Arweave gateway would be a drop-in replacement behind the same route.

Error bodies use the `{ error, code }` shape (`AVErrorResponse`); success bodies
never contain `success:false` (which the client throws on).

## Verification

- `npm test` (unit + route tests under `lib/polytician/__tests__`,
  `app/api/memory-repo/__tests__`, `app/api/inference/__tests__`,
  `app/api/archival/__tests__`, `lib/__tests__/polytician-client.test.ts`) and
  `npm run lint`.
- Curl the six endpoints with `Authorization: Bearer hv_…` against a dev
  deployment.
- End-to-end: configure a real Polytician against a dev HyperVault, run
  `save_concept` → `vault_memory_push` → `vault_memory_pull`, and confirm the
  round-trip plus provenance in `/api/mind/commits?branch=polytician-main`.

## Out of scope (follow-ups)

- A native `hypervault` provider in the Polytician repo (works today via its
  generic AgentVault config).
- A read-only `/search` HTTP endpoint in Polytician's sidecar — would unlock true
  concept recall from Polytician's store inside HyperVault chat.
- A real Arweave gateway behind `/api/archival/upload`; ICP/vetKD secrets; the
  PolyVault chunked-bundle sync protocol.
