# M9 — On-Device & WebLLM Inference

**Status:** Ready for implementation handoff
**Epic:** M9 — On-Device & WebLLM Inference
**Depends:** M8 (chat surface, thread UI, model picker slot), M1 (SDK, capabilities, offline mutation queue)

> This is **the on-device story** — the headline reason the mobile client
> exists. Chat runs on an on-device foundation model (Apple Foundation Models on
> iOS, AICore / Gemini Nano on Android) or a bundled WebLLM runtime when the
> platform model is unavailable, so the common case is private, offline-capable,
> and key-free. The chat feature depends only on the `ChatModel` interface (spec
> §5); this epic supplies its three implementations and wires the
> `context`→`generate`→`turns` flow into the M8 thread UI.
>
> **RN/Expo-specific:** native modules are Swift (Apple) + Kotlin (Android)
> behind one TS interface, and WebLLM runs in a `react-native-webview`. A
> native-native stack substitutes equivalent modules — the task-level flow
> (context/turns split, streaming into the thread, offline defer) is identical.

---

## Goal

Ship the `ChatModel` strategy interface (`on-device | webllm | remote`) with a
platform on-device model, a bundled WebLLM fallback, and the remote backend, and
wire the on-device chat flow: `POST /api/chat/context` (assemble the exact same
HyperVault context the server would) → `model.generate()` streaming on device →
`POST /api/chat/turns` (persist). Tokens stream into the same M8 thread. The app
resolves the best available model automatically (Settings can override), streams
the first token in under 2s on a warm 1–3B model, and — the headline capability —
**generates offline**, deferring only the persist to the M1 mutation queue.

---

## User stories

- As a user, my chat runs on my phone's own model by default: private, offline,
  no API key, and I see the reply stream token-by-token.
- As a user on an older phone or one without a platform model, chat still works
  on a bundled WebLLM model that downloads once and caches for offline use.
- As a user, I pick which on-device model (or a remote backend) chat uses in
  Settings, and I understand from the picker that on-device prompts never leave
  my device except the transcript I choose to store.
- As a user on a plane, I ask a question, get an on-device answer, and it syncs
  to my vault automatically when I reconnect.
- As a user who needs tools, I understand on-device chat is tool-free and I pick
  a remote backend for that turn.

---

## Tasks

| ID | Title | Pts | Depends | Description / Acceptance |
| --- | --- | --- | --- | --- |
| T-M9-01 | Define the `ChatModel` interface + registry | 2 | M8 | Implement the spec §5 interface: `{id, label, kind:"on-device"|"webllm"|"remote", available():Promise<bool>, generate({system?, messages:CanonicalMessage[], signal?, onToken?}):Promise<{text,model}>}`. A registry enumerates available models for the picker. The M8 chat store depends only on this interface. Unit-test the message mapping (canonical roles `system/user/assistant/tool` → each runtime). |
| T-M9-02 | Apple Foundation Models native module — generate | 2 | T-M9-01 | Swift native module (Expo config plugin) wrapping the `FoundationModels` framework (iOS ≥ 18 / Apple Intelligence). Bridge one async `generate(system, messages)` call returning full text. Map canonical messages to the framework's session/prompt API. Handle unavailable-hardware and model-not-ready errors as thrown JS errors. |
| T-M9-03 | Apple FM availability gate | 1 | T-M9-02 | Implement `available()` for the Apple model: gate on OS version (≥ 18), device capability, and model download/enablement state (Apple Intelligence enabled). Returns false cleanly on unsupported devices so the ladder (T-M9-11) can fall through. |
| T-M9-04 | Apple FM token streaming | 1 | T-M9-02 | Stream partial tokens from the framework's streaming response over the bridge and invoke `onToken(t)`; honor `signal` (AbortSignal) to cancel generation. Resolve with the full accumulated text + a `model` id. |
| T-M9-05 | Android AICore / Gemini Nano module — generate | 2 | T-M9-01 | Kotlin native module wrapping AICore / Gemini Nano (`com.google.ai.edge` / ML Kit GenAI). Bridge one `generate(system, messages)` returning full text, mapping canonical messages to the runtime's prompt API. Surface device-unsupported and feature-not-installed errors as thrown JS errors. |
| T-M9-06 | Android availability gate + feature download | 1 | T-M9-05 | `available()` for the Android model: gate on AICore presence, device support, and the Gemini Nano feature being downloaded/ready; trigger/await the feature download where the API allows, else return false to fall through the ladder. |
| T-M9-07 | Android token streaming | 1 | T-M9-05 | Stream partial results over the bridge into `onToken(t)`, honor `signal` cancellation, resolve with full text + `model` id. |
| T-M9-08 | WebLLM webview host | 2 | T-M9-01 | A `react-native-webview` hosting the bundled [WebLLM](https://github.com/mlc-ai/web-llm) runtime with a small quantized model (e.g. Llama-3.2-1B/3B-Instruct or Qwen2.5 — the default is an open question, spec §13). The webview HTML/JS is bundled locally (no remote origin, no app same-origin per spec §10). Boots the WebLLM engine and reports ready. |
| T-M9-09 | WebLLM model download-once + cache + progress UX | 2 | T-M9-08 | First run downloads the quantized weights **once** and caches them for offline reuse — mirror the pocket-tts "download once, cache offline" UX: a determinate progress bar with size, resumable/retry on failure, and a cached-state indicator afterward. Subsequent launches load from cache with no network. |
| T-M9-10 | WebLLM postMessage streaming bridge | 2 | T-M9-08 | The RN↔webview protocol: RN posts `{system, messages}`; the webview streams `{token}` messages and a final `{done, text}` (and `{error}`). Implement the `WebLLMModel.generate()` around this bridge — `onToken` per `{token}`, resolve on `{done}`, honor `signal` by posting an abort. |
| T-M9-11 | Model resolution ladder + RAM gate | 2 | T-M9-03, T-M9-06, T-M9-10 | Default ladder: (1) platform on-device model, (2) WebLLM, (3) remote backend — first whose `available()` is true, unless Settings pins one. Add a **RAM gate**: below the minimum-RAM threshold (spec §13 open question) skip WebLLM and fall back to a remote backend if one exists; if nothing is available, tell the user to connect a backend (M10). |
| T-M9-12 | Settings model picker + privacy note | 2 | T-M9-11 | A Settings picker listing all `ChatModel`s uniformly by `kind` (on-device / WebLLM / remote), showing availability + (for WebLLM) cache/download state. Selecting one pins it as the default (overriding the ladder). Include the **privacy note**: on-device/WebLLM prompts and replies never leave the device except the transcript the user stores via `/api/chat/turns`. The same picker also surfaces in the M8 composer's model slot. |
| T-M9-13 | On-device chat flow wiring | 2 | T-M9-11, M8 | Wire the flow into the M8 thread: on send, `POST /api/chat/context {message, conversation_id?, use_recall?, use_smart_context?, use_deep_memory?}` → `{conversation_id|null, system, messages, next_position, recalled, recalled_memories, smart_context, deep_memory}`; run `model.generate({system, messages})`; then `POST /api/chat/turns {user_message, assistant_content, conversation_id?, title?, model}` → `{conversation_id, reply:{id,role,content,model}}`. Adopt the returned `conversation_id` on the first turn; render `recalled_memories`/`deep_memory`/`smart_context` from the context response exactly like M8. Handle context 400/413/404/503 and turns 400/413/404/500/503 verbatim. |
| T-M9-14 | Native token streaming into the thread | 1 | T-M9-13, T-M8-04 | Render the assistant bubble incrementally from `onToken`, appending into the same M8 thread renderer (replacing M8's determinate "thinking" state for the on-device path). Strip `<think>` reasoning traces from the streamed text before display. On completion, attach the persisted `reply.id` so TurnActions (M8) light up. Cancel on navigation-away via `signal`. |
| T-M9-15 | Offline generate + deferred persist | 2 | T-M9-13, M1 | **Headline offline capability.** When offline: `POST /api/chat/context` uses cached context where possible (or a minimal local system prompt if unreachable — document the reduced-recall degradation), `model.generate()` runs fully offline, and the `POST /api/chat/turns` persist is **enqueued on the M1 mutation queue**. The reply shows immediately with a "will sync" indicator; on reconnect the queue replays `turns` and reconciles the `conversation_id`/message ids. |
| T-M9-16 | Tool-free routing to a remote backend | 1 | T-M9-13, M8 | Document + enforce that on-device/WebLLM chat is **tool-free** (semantic dispatch runs server-side against the compiled toolkit only). When a user has tools enabled and the resolved model is on-device, surface an affordance to route the turn through a remote backend via `POST /api/chat` (M8) instead. Not a bug — spec §4.3. |

---

## Out of scope / notes

- **Tool dispatch** is never on the on-device path — `POST /api/chat/context`
  returns no toolkit and `POST /api/chat/turns` runs no tools. Tools require a
  remote backend + `POST /api/chat` (M8/M11).
- **Open questions (spec §13):** which quantized model ships as the WebLLM
  default, and the minimum-RAM gate for T-M9-11 — resolve early.
- **Non-functional:** first on-device token < 2s on a mid-tier 2024 phone with
  the 1–3B model warm (spec §11).
- The `context`/`turns` split preserves the **entire** HyperVault context
  pipeline (wiki recall, smart-context compaction, deep-memory GraphRAG, learned
  style preferences) and identical side effects to server chat (stenographer
  feed, git-mind wiki mirror) — the on-device model just does the inference in
  the middle.
