# M8 — Chat: Server Backends

**Status:** Ready for implementation handoff
**Epic:** M8 — Chat — Server Backends
**Depends:** M1 (SDK, capabilities bootstrap, offline queue), M2 (auth + invite gate)

> This epic is the **shared chat surface** — the thread UI, composer, history,
> per-turn actions, and sharing — driven by a **remote backend** via the
> existing `POST /api/chat` (non-streaming, `maxDuration 120`). It is the parity
> port of `components/chat/chat-surface.tsx`. [M9](./09-on-device-inference.md)
> reuses this same thread UI for on-device/WebLLM inference (via the
> `context`/`turns` split), and [M10](./10-byo-llm-backends.md) owns the backend
> connect/edit/delete forms this surface embeds. The model picker, toggles, and
> turn actions here are the contract those two epics plug into.

---

## Goal

A HyperVault user can, on the phone, do everything the web chat does: browse and
reopen every conversation (native + imported), start a new chat, pick a
connected backend and switch it mid-thread with zero context loss, tune wiki
recall / smart context / deep memory / tools, send a turn and read a grounded
reply with its recall provenance and any tool dispatches, then act on that reply
(copy, save to vault as artifact or memory, thumbs, read aloud), and control who
can see the conversation.

The canonical history is server-side and provider-agnostic, so a thread that
started on Claude continues on Grok unchanged — the vault is the memory, the
model is just the engine.

---

## User stories

- As a user, I see all my conversations (native + imported from ChatGPT/Claude/
  Gemini/Grok) and can reopen any one and continue it.
- As a user, I start a new chat, type a multiline message, and send it to the
  backend I picked.
- As a user, I switch the backend mid-conversation and my history comes with me.
- As a user, I toggle wiki recall, smart context, deep memory, and tools, and
  the reply reflects them (with the recalled memories and tool dispatches
  shown).
- As a user, I copy a reply, save its code to my vault as an artifact, save it
  as a memory, rate it thumbs up/down, or have it read aloud.
- As a user, I make a conversation shared or public and copy its `/c/<slug>`
  link, or delete it.

---

## Tasks

| ID | Title | Pts | Depends | Description / Acceptance |
| --- | --- | --- | --- | --- |
| T-M8-01 | Conversation list + history drawer | 2 | M1 | `GET /api/conversations` → `{conversations:[{id,title,source_platform,model,created_at,updated_at,visibility?,share_slug?}]}` (≤500). Desktop-tablet: persistent sidebar; phone: a left history **Drawer** opened from a toolbar button showing the active title + a count badge. Each row shows title (1-line clamp) and a platform label (map `chatgpt→ChatGPT, claude→Claude, gemini→Gemini, grok→Grok, hypervault→HyperVault, other→Imported`). Active row highlighted. Loading/empty (with an "Import your history" pointer to M12)/error states. Cache the list per §7. |
| T-M8-02 | New chat + empty thread state | 1 | T-M8-01 | "New chat" clears the active id and messages locally — no API call until the first send. Empty thread shows the "Your whole AI life, one surface" hint. Phone toolbar has a "New" button beside the history button. |
| T-M8-03 | Open conversation + hydrate history | 2 | T-M8-01 | `GET /api/conversations/[id]` → `{conversation, messages:[{id,role,content,attachments,model,position,created_at,feedback?}]}`. For assistant rows, strip `<think>…</think>` reasoning traces before display (fall back to the reasoning text only if the reply is all-reasoning). Hydrate persisted tool traffic: a `tool` role row is a ` ```tool-result ` block → render as a **ToolTurn** blade (T-M8-11); an assistant row ending in a ` ```tool ` intent block collapses to its visible text (drop it if none). Map stored `feedback` (`1`/`-1`) to `up`/`down`. Loading/error states. |
| T-M8-04 | Thread renderer | 2 | T-M8-03 | Render the message list: user bubbles right-aligned (primary), assistant left-aligned (bordered). Assistant footers when present: `truncated` warning ("backend stopped at its length limit — say 'continue'"), `recalled_memories` ("Grounded in your memories: …"), `deep_memory` labels ("From your conversation graph: …"), and the `model` tag. Auto-scroll to the newest turn. `whitespace-pre-wrap`; accessible roles. |
| T-M8-05 | Composer | 1 | T-M8-04 | Multiline text input; **Enter sends, Shift+Enter newlines** (on phone, a dedicated Send button is primary since soft keyboards send newlines). Placeholder names the active backend. Send disabled while busy, when empty, or when no backend is connected. Client-guard message length to `capabilities.limits.chat_message_chars` (100k) before POST. |
| T-M8-06 | Backend picker | 1 | T-M8-05, T-M10-01 | A select listing connected backends (`name — default_model`) sourced from M10's backend list. Selecting sets the `backend_id` used on send; switching mid-thread is lossless (history is canonical). When none are connected, show "No backends connected" and point to M10's connect form. |
| T-M8-07 | Wiki-recall toggle | 1 | T-M8-05 | A per-send **local** toggle (default on), sent as `use_recall` on `POST /api/chat`. Not persisted — it only affects the current send. Pressed/`aria-pressed` styling. |
| T-M8-08 | Smart-context + deep-memory toggles | 2 | T-M8-05, M1 | Load defaults from `GET /api/chat-settings` → `{smart_context,deep_memory}`. Both are persisted toggles: flip locally + fire `PATCH /api/chat-settings {smart_context?}` / `{deep_memory?}` in the background (failure is harmless — each send also carries the current value as `use_smart_context`/`use_deep_memory`). **Deep memory is only shown when `capabilities.features.deep_memory` is true.** |
| T-M8-09 | Tools toggle | 1 | T-M8-05, M11 | `GET /api/toolkits` → show the toggle only when `toolkit` is non-null. Local `use_tools` state (default on), sent on `POST /api/chat`. A separate "Add tools / Manage" affordance deep-links to M11. (Compiling/managing toolkits is M11; this task only gates + passes the flag.) |
| T-M8-10 | Send a turn | 2 | T-M8-04, T-M8-06 | Optimistically append the user bubble, clear the draft, show a **determinate "Thinking…" state** (the route is non-streaming, up to 120s — surface elapsed progress, not a spinner-forever). `POST /api/chat {backend_id, message, conversation_id?, use_recall, use_smart_context, use_deep_memory, use_tools?}` → append any `tools.turns` as ToolTurn rows, then the `reply:{id,role,content,model,truncated}` with `recalled_memories`/`deep_memory`/`smart_context`. On first turn, adopt the returned `conversation_id` and prepend it to the list. If `tools.status==="stale"`, surface "recompile your toolkit under Tools". Handle 400/413/404/502/500 + network error verbatim; roll back the optimistic bubble on failure. |
| T-M8-11 | ToolTurn blade | 1 | T-M8-04 | Render a semantic dispatch as a collapsed, dashed blade: `"intent" → tool` with a confidence **tier** badge (`tier` + rounded `confidence`%), red "failed" when `!ok`. Expands to the result `preview`, `error`, or a `refinement` question with its options. Reused by both `POST /api/chat` live turns and hydrated history (T-M8-03). |
| T-M8-12 | TurnActions: copy + thumbs | 2 | T-M8-04 | Under each non-empty assistant reply: **Copy** (clipboard) and **thumbs up/down**. Thumbs `POST /api/messages/[id]/feedback {feedback:"up"|"down"|null}` — tapping the active one clears it; optimistic with rollback on failure; disabled until the message has an id. Errors (incl. `400` non-assistant, `503 0014`) shown inline verbatim. |
| T-M8-13 | Share menu: save as artifact / memory | 2 | T-M8-12 | A share affordance on the assistant reply opens a menu: **Copy text**; **Save (code) as artifact** → `POST /api/save` (if a code artifact is detected, save it as-is with `tags:["chat"]`; otherwise wrap the prose as an HTML page with `force_html:true`), carry the prior user message as `source_prompt` (≤10k); **Save as memory** → `POST /api/memories {title,content,tags:["chat"],source:"chat"}`. On success show the `/a/<slug>` link (with a private-visibility note) or the memory confirmation. |
| T-M8-14 | Save-to-Vault artifact blade | 1 | T-M8-04 | When an assistant reply contains a detected artifact (full HTML page or React/JSX component, fenced or bare), render an inline "⚡ Save to Vault" action inside the bubble: `POST /api/save {title,content,tags:["chat"],source_prompt?}` → returns the permanent `/a/<slug>` link with copy button; label whether an "HTML page" or "React component" was detected; handle the `duplicate:true` response. Renders nothing when no artifact is present. |
| T-M8-15 | Conversation visibility + share link | 2 | T-M8-03 | On an open conversation, a visibility select: **Private / Shared — link only / Public**. `PATCH /api/conversations/[id] {visibility}` → `{conversation, share_url, message}`; update the local row's `visibility`+`share_slug`. When shared/public and a `share_slug` exists, a "Copy link" button copies `<app_url>/c/<share_slug>`. Handle `503 0016`. Default posture: chats are private. |
| T-M8-16 | Delete conversation | 1 | T-M8-03 | `DELETE /api/conversations/[id]` behind a native destructive confirm (Alert/action sheet). On success remove the row; if it was active, fall back to the new-chat empty state. Optimistic with rollback on failure. |
| T-M8-17 | Read-aloud button (hand-off to M14) | 1 | T-M8-12 | Place a "Speak" button in the TurnActions row for non-empty replies. The button's press wires to the on-device TTS engine delivered in [M14](./14-tts-read-aloud.md) (speaker-per-reply, tap-to-stop). This task owns only placement + the M14 interface call; the engine itself is M14. |

---

## Out of scope / notes

- **Streaming.** `POST /api/chat` returns only after the whole turn (up to 120s),
  so remote-backend chat here is a **determinate "thinking" state**, never a
  token stream. On-device/WebLLM streams natively — that is M9's job and a UX
  reason to default to on-device. A future SSE `POST /api/chat` variant is out
  of scope (backend roadmap, spec §11).
- **Tools are server-side only.** The `use_tools` path exists solely on `POST
  /api/chat` (remote backends). On-device chat is tool-free by design — see M9.
- **Backend connect/edit/delete forms** are [M10](./10-byo-llm-backends.md); this
  surface embeds them but does not own them.
- Every send carries the toggle state explicitly, so the persisted
  `chat-settings` values only matter for the *next* session — a failed PATCH
  costs nothing this session.
