# M10 — Power-User BYO LLM

**Status:** Ready for implementation handoff
**Epic:** M10 — Power-User BYO LLM
**Depends:** M8 (chat surface, backend picker slot), M1 (SDK, capabilities, secure store)

> Bring your own LLM: point chat at any backend HyperVault supports — OpenAI,
> Anthropic, xAI, Gemini, Mistral, Ollama, LM Studio, or a custom OpenAI-/
> Anthropic-compatible endpoint — connect it from the phone with a live
> connection test, and switch mid-conversation with zero context loss. This is
> the parity port of the `BackendManager`/`BackendEditor` in
> `components/chat/chat-surface.tsx`. The connected backends feed M8's picker
> and M9's `remote` `ChatModel` kind.

---

## Goal

A power user can connect, list, edit, rotate the key of, and delete LLM backends
from the phone (max 20), across every provider in the registry, with a live
connection test on connect/edit. Keys are stored server-side encrypted by
default; when the server can't encrypt (`capabilities.features.key_encryption ===
false`), keys live in device secure storage and that backend is driven directly
from the phone instead of persisting the key server-side.

---

## User stories

- As a power user, I connect OpenAI/Anthropic/xAI/Gemini/Mistral by picking the
  provider and pasting a key, and I get told immediately if it works.
- As a power user, I connect a custom OpenAI- or Anthropic-compatible endpoint
  by giving a base URL and model.
- As a power user, I set an embedding model on an OpenAI-protocol backend so
  semantic recall works.
- As a power user, I rename a backend, rotate its key, or repoint its model/URL
  without disconnecting.
- As a privacy-conscious user on a server that can't encrypt keys, my key stays
  on my device and that backend is driven directly.
- As a user, I understand that local runtimes (Ollama, LM Studio) on `localhost`
  point at the phone itself, so I need a LAN/tunnel URL.

---

## Tasks

| ID | Title | Pts | Depends | Description / Acceptance |
| --- | --- | --- | --- | --- |
| T-M10-01 | Backends list | 2 | M1 | `GET /api/backends` → `{backends:[{id,name,provider,base_url,default_model,embedding_model,key_hint,created_at,last_used_at}], providers:[…specs]}`. Render each backend with its provider badge, name, model (mono), an "embeddings" badge when `embedding_model` is set (or provider is `openai`), a truncated `base_url`, and the `key_hint`. This list feeds the M8/M9 backend picker. Loading/empty/error states. |
| T-M10-02 | Provider picker + dynamic connect form | 2 | T-M10-01 | Provider select sourced from `capabilities.providers` (the registry: `openai, anthropic, xai, gemini, mistral, ollama, lmstudio, custom, custom-anthropic`). Show fields per the provider spec: an API-key field when `requiresKey`/`optionalKey`; a **model** field (placeholder = provider default); an **embedding-model** field only for `protocol==="openai"` providers; a **base-URL** field for custom + local providers. Client-validate required fields before enabling Connect. |
| T-M10-03 | Connect a backend + live test | 2 | T-M10-02 | `POST /api/backends {provider, name?, api_key?, base_url?, default_model?, embedding_model?}` (`maxDuration 60` — it sends a live test message). Show a "Testing… / Sending a test message to verify the endpoint" state. On success prepend the returned `backend` and show its `message`; on error show `{error}` verbatim. Enforce the **max 20** cap client-side (from `capabilities.limits.max_backends`) before POST. |
| T-M10-04 | Custom OpenAI-/Anthropic-compatible endpoints | 1 | T-M10-02 | For `custom` (OpenAI-compatible) and `custom-anthropic` (Anthropic-compatible), require **base URL + model** (Connect disabled until both are set); key is optional. Offer the API-style choice (OpenAI-compatible vs Anthropic-compatible) as the web form does. |
| T-M10-05 | Embedding model for OpenAI-protocol backends | 1 | T-M10-02 | For `protocol==="openai"` providers, expose the embedding-model field (placeholder = provider default, e.g. `text-embedding-3-small` for OpenAI). Explain inline that semantic recall needs a 1536-dim-compatible embedding model, verified on connect. Sent as `embedding_model`. |
| T-M10-06 | Edit backend + rotate key | 2 | T-M10-01 | Inline editor per backend: `PATCH /api/backends {id, name?, api_key?, base_url?, default_model?, embedding_model?}`. **Provider is fixed**; a blank key keeps the stored one (placeholder shows the `key_hint`). Connection-relevant changes (key/model/base URL) are re-tested server-side ("Re-verifying the endpoint before saving"). On success replace the row + show `message`. |
| T-M10-07 | Delete / disconnect a backend | 1 | T-M10-01 | `DELETE /api/backends {id}` behind a native destructive confirm. On success remove the row; if it was the active backend in the M8 picker, fall back to the next available. Optimistic with rollback. |
| T-M10-08 | Local-runtime reachability caveat | 1 | T-M10-02 | For `ollama`/`lmstudio` (and any `localhost`/`127.0.0.1` base URL), show a caveat: on a phone `localhost` is **the phone itself**, and the HyperVault server (which makes the call for server-stored backends) must be able to reach the runtime — use a LAN IP or tunnel URL (ngrok, Tailscale Funnel), not `localhost`. Mirror the web copy. |
| T-M10-09 | `key_encryption`-off branch: secure-store the key | 2 | T-M10-03, M1 | When `capabilities.features.key_encryption === false`, do **not** send the key to `POST /api/backends` (the server can't protect it, spec §10). Instead store the key in `expo-secure-store` on device, keyed to a locally-tracked backend record, and mark the backend "device-local". The connect form branches on this flag. Never send a key the server can't encrypt. |
| T-M10-10 | Direct-drive adapter for device-local backends | 2 | T-M10-09, T-M9-01 | For a device-local backend (T-M10-09), implement a `remote`-kind `ChatModel` that calls the provider **directly from the phone** using the secure-store key + the provider protocol (`openai`/`anthropic`/`gemini`), instead of routing through `POST /api/chat`. Persist the resulting turn via `POST /api/chat/turns` (M9) so history/recall/git-mind stay identical. Reachability + TLS caveats apply. |
| T-M10-11 | Backend picker integration | 1 | T-M10-01, M8, M9 | Expose the connected backends to the M8 composer picker and register each as a `remote` `ChatModel` (T-M9-01) in M9's registry so a remote backend is a first-class entry in the model resolution ladder and Settings picker. |
| T-M10-12 | Connection-test + error surfacing | 1 | T-M10-03 | Consistent test/busy/success/error UX across connect + edit: the "Testing…"/"Re-verifying…" states, `{error}` shown verbatim inline (including `400`/`503`/`500`), and a success `message`. Distinguish a failed live test from a network error. |

---

## Out of scope / notes

- **Where keys live:** server-side, AES-256-GCM encrypted at rest, is the default
  (`POST /api/backends`). Only when `capabilities.features.key_encryption` is
  false do keys stay on-device in secure store and drive the backend directly
  (T-M10-09/10) — spec §10.
- **The chat surface** that uses these backends is [M8](./08-chat-core.md); the
  on-device model interface a remote backend registers into is
  [M9](./09-on-device-inference.md).
- **API keys** (`/api/keys`, HyperVault agent keys) are a different concept — not
  this epic; that's M2/power-user tooling.
- Provider registry fields (`protocol`, `defaultBaseUrl`, `defaultModel`,
  `requiresKey`, `optionalKey`, `defaultEmbeddingModel`) come from
  `capabilities.providers` — never hard-code them client-side.
