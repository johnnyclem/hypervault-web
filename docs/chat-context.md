# Smart context & deep memory (vault chat)

Two optional, on-by-default context engines for `/chat`, integrating
[short-hand](https://github.com/johnnyclem/short-hand) and
[stenographer](https://github.com/johnnyclem/stenographer) as first-class
parts of the chat pipeline.

|  | Smart context | Deep memory |
|---|---|---|
| Powered by | short-hand (vendored, `lib/vendor/short-hand`) | stenographer REST sidecar |
| What it does | Compacts older turns of the current thread into a token-budgeted summary block | GraphRAG recall across *all* conversations (entities, decisions, past messages) |
| Runs | In-process, pure CPU, serverless-safe | As a separate daemon; queried over HTTP |
| Needs setup | No | Yes — `STENOGRAPHER_URL` (+ ingestion, below) |
| Toggle | "Smart context" chip in the composer | "Deep memory" chip (hidden unless configured) |
| Persisted where | `profiles.chat_smart_context` (migration 0017) | `profiles.chat_deep_memory` (migration 0017) |

Both default ON; a database that predates migration 0017 behaves identically
(the app coalesces missing columns to `true`). Each chat request also accepts
per-request overrides `use_smart_context` / `use_deep_memory`, which is what
the composer chips send.

## Data flow (one chat turn)

```
ChatSurface.send()
  POST /api/chat { backend_id, message, conversation_id?,
                   use_recall, use_smart_context, use_deep_memory }
        │
        ├─ loadChatContextSettings(profiles) ─ overrides applied per request
        ├─ fetch canonical history (200 turns; 1000 when smart context is on)
        ├─ concurrently:
        │    ├─ deep memory:  GET $STENOGRAPHER_URL/graphrag?q=<recall query>
        │    │                (1.5 s timeout, any failure → block omitted)
        │    └─ wiki recall:  recallArtifacts + recallMemories   (unchanged)
        ├─ smart context: compactChatHistory(canonical)
        │      older turns → CompactionEngine (regex tier) → context frame
        │      last 12 turns stay verbatim as real messages
        ├─ system = [deep memory] + [wiki recall] + [compacted history]
        │           + [feedback preferences]
        ├─ sendChat(backend, keptMessages ?? canonical, system)
        ├─ persist both turns; appendTranscript → $STENOGRAPHER_LOG_PATH
        │                                        (self-hosted only, best-effort)
        └─ syncConversationMemory(full canonical)   — wiki mirror stays lossless
```

## Smart context (short-hand)

`lib/shorthand/compact.ts` is the only module that touches the vendored
library. Per request it rebuilds a `CompactionEngine` from the canonical
history — the `messages` table stays the single source of truth (imports,
backend switches, and edits all write there), and regex-tier compaction of a
few hundred messages is millisecond work, so nothing is persisted or cached.

Tuning constants (top of `lib/shorthand/compact.ts`):

- `KEEP_RAW_TURNS = 12` — recent turns that always travel verbatim.
- `COMPACT_BUDGET_TOKENS = 3000` — budget for the compacted block.
- `MIN_MESSAGES_TO_COMPACT = 20` — shorter threads skip compaction entirely.

Only the zero-dependency **regex tier** is used (short-hand's local/host LLM
tiers stay off), so compaction never makes a model call and never adds
latency beyond CPU work. When smart context is active the history fetch
window widens from 200 to 1000 turns — compaction bounds what reaches the
provider, so the wider read *increases* how much of a long thread the model
can see while still cutting tokens.

Known trade-off: regex-tier summaries are lossy (~20-30% decision recall
upstream). Mitigations: the last 12 turns are always verbatim, wiki recall
still excerpts the full transcript from the memory mirror, and the feature
turns off per-user or per-request.

## Deep memory (stenographer)

HyperVault deliberately has **no npm dependency on `@stenographer/core`** —
it needs native modules (better-sqlite3, sqlite-vec) and a persistent SQLite
file, which don't run inside serverless functions. Instead
`lib/stenographer/client.ts` talks plain HTTP to a sidecar daemon and treats
every failure as "no extra context":

- `STENOGRAPHER_URL` unset → the feature is hidden in the UI and skipped in
  the route. Zero cost.
- Sidecar down or slow → 1.5 s timeout, turn proceeds without the block.

### Ingestion — getting transcripts into the sidecar

stenographer's REST API is read-only; it ingests by **tailing a JSONL file**.
Two topologies:

**Self-hosted (shared filesystem)** — set `STENOGRAPHER_LOG_PATH`; the chat
route appends one JSONL line per turn (`lib/stenographer/log.ts`, shape =
stenographer's `jsonl` adapter: `{id, role, content, timestamp, sessionId}`),
and the sidecar tails the same file:

```yaml
# docker-compose sketch
services:
  hypervault:
    build: .
    environment:
      STENOGRAPHER_URL: http://stenographer:8787
      STENOGRAPHER_LOG_PATH: /transcripts/chat.jsonl
    volumes: [transcripts:/transcripts]
  stenographer:
    image: node:22
    command: npx -y stenographer start /transcripts/chat.jsonl
             /transcripts/stenographer.db
             --mode daemon --adapter jsonl --rest-port 8787
    volumes: [transcripts:/transcripts]
volumes:
  transcripts:
```

**Vercel + remote sidecar (no shared disk)** — leave `STENOGRAPHER_LOG_PATH`
unset (the append silently no-ops) and run
`scripts/stenographer-export.mjs` on the sidecar host on a timer. It pulls
new `messages` rows from Supabase (service-role key), appends them to the
tailed file, and keeps a cursor so each run is incremental. Deep memory
freshness equals the timer cadence — minutes-stale, not real-time.

```
* * * * * cd /opt/hypervault && SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/stenographer-export.mjs /var/lib/stenographer/chat.jsonl
```

A possible phase 2 is embedding stenographer in-process for `next start`
deployments (`@stenographer/core` as an optional dependency +
`serverExternalPackages: ["better-sqlite3", "sqlite-vec", "@xenova/transformers"]`),
but the REST-only path keeps one code path for every deployment.

## Degradation matrix

| Condition | Behavior |
|---|---|
| Database pre-0017 | Settings read as ON; `PATCH /api/chat-settings` returns 503 with the migration hint; chat unaffected |
| `STENOGRAPHER_URL` unset (Vercel default) | Deep-memory chip hidden, route skips the lookup |
| Sidecar down / slow | 1.5 s timeout → block omitted, turn proceeds |
| `STENOGRAPHER_LOG_PATH` unset | Append skipped; ingest via the export script |
| Thread too short / compaction throws | Raw-history path, byte-identical to pre-feature behavior |
| User toggles a chip off | Per-request flag forces the old behavior regardless of profile |

## Surfaces

- `POST /api/chat` — accepts `use_smart_context` / `use_deep_memory`; response
  gains `smart_context: boolean` (did compaction run) and
  `deep_memory: string[] | null` (labels of graph entries that grounded the
  reply, rendered under the message like wiki-recall grounding).
- `GET|PATCH /api/chat-settings` — the persisted toggles.
- Vendored library upkeep: `lib/vendor/short-hand/VENDORED.md` records the
  pinned commit and the refresh procedure.
