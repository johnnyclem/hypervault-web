# Imaging V3 — Export from Any LLM + Connect Any Backend

Imaging V3 turns HyperVault into an LLM-agnostic personal OS: pull your full
chat history out of any platform, plug in any model, and keep one memory graph
across all of them.

## Export pipeline

**Route:** `POST /api/import` — body `{ data, platform?, title? }`, where
`data` is the raw contents of a platform export or a pasted transcript.
**UI:** `/vault/import`.

Supported sources (auto-detected, `platform` hint optional):

| Platform | Export file | Notes |
| --- | --- | --- |
| ChatGPT | `conversations.json` (OpenAI data export) | Reconstructs the visible thread from the `mapping` node tree (edited/regenerated branches are dropped, matching what you last saw), fences code parts, keeps attachments + model slugs |
| Claude | `conversations.json` (Anthropic data export) | Handles both `text` and content-block messages; attachment `extracted_content` is preserved and re-injected as context in chat |
| Gemini | `MyActivity.json` (Google Takeout) | Activity-log shaped, grouped into per-day threads; replies parsed from `safeHtmlItem` when present |
| Grok | X data archive / grok.com export | `responses` list with human/grok sender flags |
| Generic JSON | `[{title, messages: [{role, content}]}]` | For agents and custom pipelines |
| Paste fallback | `User:` / `Assistant:` labeled transcript | The manual fallback for mobile apps that make full export tricky |

Everything normalizes into the canonical format (`lib/chat/canonical.ts`):
conversations + messages + attachment metadata, stored in the
`conversations`/`messages` tables. Re-imports are idempotent per
`(platform, external conversation id)`, message inserts are batched (500 rows
per insert) so very large histories go in reliably, and imports are capped at
50 MB per request — split gigantic exports into parts.

## Backend connector layer

**Route:** `GET/POST/PATCH/DELETE /api/backends`. **UI:** "Manage backends" in `/chat`.

| Provider | Protocol | Default endpoint |
| --- | --- | --- |
| OpenAI | `openai` | `https://api.openai.com/v1` |
| Anthropic (Claude) | `anthropic` | `https://api.anthropic.com` |
| xAI (Grok) | `openai` | `https://api.x.ai/v1` |
| Google (Gemini) | `gemini` | `https://generativelanguage.googleapis.com` |
| Mistral | `openai` | `https://api.mistral.ai/v1` |
| Ollama (local) | `openai` | `http://localhost:11434/v1` (no key) |
| LM Studio (local) | `openai` | `http://localhost:1234/v1` (no key) |
| Custom (OpenAI-compatible) | `openai` | your endpoint — fine-tunes, enterprise gateways, anything OpenAI-compatible |
| Custom (Anthropic-compatible) | `anthropic` | your endpoint — proxies and gateways that speak the Anthropic `/v1/messages` API |

Three wire protocols cover everything (`lib/backends/chat.ts`); the registry
(`lib/backends/providers.ts`) maps each provider to its protocol, default base
URL, and default model. API keys are AES-256-GCM encrypted at rest
(`lib/backends/crypto.ts`) using `HYPERVAULT_KEY_SECRET` (falls back to a key
derived from the service-role key), and are never returned to the browser —
only a display hint is.

Connecting a backend sends a one-turn test message before saving
(`lib/backends/probe.ts`), so a wrong URL, bad key, or unknown model fails at
the form instead of mid-conversation (`skip_test: true` in the POST body
bypasses it). Base URLs are normalized — trailing slashes and a pasted
`/chat/completions` path are stripped — and when an OpenAI-compatible endpoint
404s, the probe retries likely roots (`…/v1`, origin + `/v1`) and saves the
one that answers.

Connected backends are editable in place (`PATCH /api/backends`, "Edit" on the
backend row): rename it, rotate the key, or switch the model, Base URL, or
embedding model without disconnecting. Omitted fields keep their stored
values; a blank key keeps the current one (keys can be replaced, not cleared).
The provider itself is fixed — switching providers is a new backend. Edits
that touch the connection (key, model, Base URL) re-run the same one-turn
test before saving (`lib/backends/update.ts` decides what changed); a
name-only edit saves without a network round-trip.

### Troubleshooting

- **404 / "path not found"** — the Base URL isn't the API root. It should
  usually end in `/v1` (Ollama cloud is `https://ollama.com/v1`, not
  `https://ollama.com/api/v1`) and never include `/chat/completions`.
- **Local backends on the hosted app** — chat requests are sent from the
  HyperVault *server*, so `localhost` points at the server, not your device.
  Run HyperVault on the same machine, or expose the local backend with a
  tunnel (`ngrok http 11434`, Tailscale Funnel) and use that URL.

## Chat surface

**Route:** `POST /api/chat` — body `{ backend_id, message, conversation_id?, use_recall? }`.
**UI:** `/chat` — same sidebar, same vault, no tabbing over to chatgpt.com.

- Conversation history is stored canonically, so a thread that started in
  Claude continues on Grok (or your local Ollama) with zero context loss —
  the model is an engine, the vault is the memory.
- **Wiki recall:** before each turn, the user's most relevant vault artifacts
  (keyword overlap on titles/tags — the same heuristic as smart connections)
  are injected as a system-prompt context block with titles, permanent URLs,
  and source prompts. Toggleable per conversation.
- Works with session auth or `X-HyperVault-Key`, so agents can drive the chat
  API too.

## Known edge cases

- Mobile apps without a real export path → paste fallback on `/vault/import`.
- Very large histories → batched inserts; if a single request exceeds 50 MB,
  import in parts.
- Platform-exclusive features (Canvas, Advanced Data Analysis) don't port 1:1 —
  code arrives as fenced blocks, and the artifact workflow (`/api/save` + MCP)
  is the HyperVault-native equivalent.

## Schema

`supabase/migrations/0004_imaging_v3.sql` — `conversations`, `messages`,
`llm_backends`, all with owner-only RLS. Run with `supabase db push`.
