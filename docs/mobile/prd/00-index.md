# HyperVault Mobile — PRD Index & Conventions

These PRDs are the implementation handoff for the native mobile client. Read
[`../00-engineering-spec.md`](../00-engineering-spec.md) first. Then work the
epics in the order below (later epics depend on earlier ones).

## Epic order & dependencies

| PRD | Epic | Depends on |
| --- | --- | --- |
| [M1](./01-foundation.md) | Foundation & App Shell | — |
| [M2](./02-auth-onboarding.md) | Authentication & Onboarding | M1 |
| [M3](./03-vault-artifacts.md) | Vault — Artifacts | M1, M2 |
| [M4](./04-vault-graph.md) | Vault Graph | M3 |
| [M5](./05-connections-sharing.md) | Connections & Sharing | M3 |
| [M6](./06-memory-wiki.md) | Memory Wiki (Imaging V2) | M2 |
| [M7](./07-git-mind.md) | Git-for-a-Mind | M6 |
| [M8](./08-chat-core.md) | Chat — Server Backends | M2 |
| [M9](./09-on-device-inference.md) | On-Device & WebLLM Inference | M8 |
| [M10](./10-byo-llm-backends.md) | Power-User BYO LLM | M8 |
| [M11](./11-mcp-tools.md) | MCP & Tools | M8 |
| [M12](./12-import-history.md) | Import AI History | M2 |
| [M13](./13-domains-upgrade.md) | Domains & Upgrade | M2 |
| [M14](./14-tts-read-aloud.md) | Read Replies Aloud (TTS) | M8 |
| [M15](./15-admin.md) | Admin (owner) | M2 |
| [M16](./16-cross-cutting.md) | Cross-cutting | M1 |

Shared reference: [`api-contract.md`](./api-contract.md) — every endpoint's
request/response shape.

## Task format

Every PRD lists **user stories** and a **task table**. Tasks are sized in
scrum points (**1 = a few hours, 2 = up to a day**); anything that felt like 3+
was split. Each task has:

- **ID** — `T-<epic>-<n>` (e.g. `T-M3-04`), stable for cross-referencing.
- **Title** — imperative.
- **Pts** — 1 or 2.
- **Depends** — task IDs (within or across epics) that must land first.
- **Description / Acceptance** — what to build and how we know it's done.

A task is **done** when: it compiles, it has the behavior in Acceptance, it
handles the documented error/loading/offline states, it's accessible (labels +
44pt targets), and it honors the active theme + light/dark.

## Conventions all tasks inherit (don't repeat per task)

- **Auth:** every API call carries `Authorization: Bearer <jwt>` via the SDK
  (M1). 401 → refresh once, else route to sign-in.
- **Errors:** API errors are `{ error: string }`; show the text verbatim in a
  non-blocking toast/inline state. `503` with a migration hint is possible —
  show it as-is.
- **Loading/empty/error** states are required for every screen that fetches.
- **Optimistic + revalidate** for mutations; roll back on failure.
- **Destructive actions** use a native confirm (Alert/action sheet); mirror the
  web's tap-to-confirm intent.
- **Limits** come from `GET /api/capabilities` (M1) — enforce client-side
  before hitting the API (artifact 1 MB, source-prompt 10k chars, chat message
  100k chars, memory 500 kB, import 50 MB).
- **Theming + a11y** per §11 of the spec.

## Definition of parity

The app reaches parity when every row of the feature matrix in spec §2 is
implemented and a HyperVault user can do on the phone anything they can do on
the web, plus on-device chat. Track parity via the acceptance criteria across
M3–M15.
```
