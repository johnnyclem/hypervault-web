# M11 — MCP & Tools

**Status:** Draft · **Epic:** M11 · **Depends:** M8 (chat consumes the compiled toolkit)

## Goal

Bring the web tool-configuration console to the phone: list connected MCP
servers, add remote servers by URL (with optional auth headers) or one-click
from the registry, toggle whole servers and individual tools as a **draft**,
refresh a server's tool list, delete a server, and **compile** the draft into a
toolkit. Mirror the web's draft/compile model exactly — per-server and per-tool
toggles mutate a local draft and **nothing applies until Compile Tools runs**;
Undo throws the draft away. Compiled toolkits are what enable chat tool
dispatch (M8's `use_tools` turn) — surface that connection in copy. Enforce the
`max_mcp_servers` cap (20) from capabilities. Semantic tool dispatch stays
server-side, so this epic configures tools; it does not run them (spec §4.3).

## User stories

- As a user, I see every MCP server I've connected, each as an expandable blade
  with a master toggle and a per-tool list.
- As a user, I can search the MCP registry and add a remote-capable server with
  one tap, or paste any streamable-HTTP URL with optional auth headers.
- As a user, I can enable/disable a server or individual tools, see how many
  changes are pending, and either compile them or undo them.
- As a user, I can refresh a server to re-read its tool list, and remove a
  server I no longer want.
- As a user, I see toolkit status — when it compiled, tool/selector counts, the
  embedder, a stale badge — and compiling produces a result summary
  (tools → selectors, collisions, skipped servers) that tells me new chats now
  use it.

## Tasks

| ID | Title | Pts | Depends | Description / Acceptance |
| --- | --- | --- | --- | --- |
| T-M11-01 | Tools console screen + server list | 2 | T-M1-08 | Tools tab screen. `GET /api/mcp-servers` → render each `server` as a collapsible **blade** (name, url, key icon when `hasAuth`, tool-count badge `enabled/total` or `off`). Loading/empty/error states; empty state points at registry search / add-by-URL. Seed the read cache (spec §7) so the list paints offline. Acceptance: connected servers render as blades; empty state invites adding one; list revalidates on focus. |
| T-M11-02 | Draft state model (persisted vs draft, dirty tracking) | 2 | T-M11-01 | Port the web draft model: hold `persisted` and `draft` server lists; per-server `enabled` + `disabledTools[]`; compute `dirty` and a pending-change count. All toggles mutate `draft` only. Acceptance: toggling anything marks the console dirty and shows an N-changes-pending count; nothing hits the API until compile; store is unit-tested for diff/count. |
| T-M11-03 | Server blade — master + per-tool toggles | 2 | T-M11-02 | Expandable blade: master switch (`enabled`), nested per-tool switches driven by `disabledTools`, enable-all / disable-all shortcuts (disabled when the server is off), and a "changes apply when you compile" hint. Tools shown by name (+ description when room). Per-tool switches read as off when the server is off. Accessible switches (`role=switch`, `aria-checked`, 44pt). Acceptance: toggling the master or a tool updates only the draft; disabled server greys its tool list; disabled-tools ≤ 500 (contract cap on PATCH). |
| T-M11-04 | Add server by URL + auth headers | 2 | T-M11-02 | Add-by-URL form: `url` (http/https, required), optional `name`, repeatable auth header rows (key + secret value, value entered like a password). `POST /api/mcp-servers {url,name?,headers?}` (`maxDuration 60`, live introspection). On success append the returned `server` to persisted+draft and mark the toolkit stale. Handle 400 (bad url), 409 (already connected), 502 (introspection failed) verbatim; enforce `max_mcp_servers` client-side before POST. Note headers are encrypted server-side and never returned. Acceptance: a valid URL connects and its tools appear; the 20-server cap blocks a 21st with a clear message; a 502 shows the server's error. |
| T-M11-05 | Registry search + one-click add | 2 | T-M11-04 | Debounced (300 ms) `GET /api/registry/search?q=` → list results (name, transport badge, description). Show `capabilities` suggested/`suggested` entries before a query. One-tap Add → `POST /api/mcp-servers {url,name,registry_id}`; button shows Verifying/Added; disable Add for URLs already connected. Registry outage or no remote-capable matches degrades to a hint pointing at add-by-URL. Acceptance: typing searches after debounce; adding from a result connects with its `registry_id`; already-connected servers show "Added"; a registry failure never blocks the URL path. |
| T-M11-06 | Refresh a server's tool list | 1 | T-M11-03 | Per-blade refresh action → `POST /api/mcp-servers/[id]/refresh` → replace that server's `tools` + `disabled_tools` + `introspected_at` in both persisted and draft. Spinner while in flight; 502 shows the error inline. Acceptance: refreshing re-reads tools without losing unrelated draft edits; a newly discovered tool appears; failure leaves the prior list intact. |
| T-M11-07 | Delete a server (confirm) | 1 | T-M11-03 | Per-blade delete with a native confirm mirroring web copy ("Remove {name}? Compiled toolkits keep working until you compile again."). `DELETE /api/mcp-servers/[id]` → remove from persisted+draft. Acceptance: confirming removes the blade; cancelling is a no-op; error surfaces verbatim and keeps the server. |
| T-M11-08 | Toolkit status header + stale badge | 1 | T-M11-01 | `GET /api/toolkits` → header line: compiled-at, `stats.toolCount` tools + `uniqueSelectorCount` selectors, embedder label badge, and a **stale — recompile** badge when `stale` is true or a server was added/edited since compile. "No toolkit compiled yet" empty state. Acceptance: header reflects the current toolkit; adding a server flips the stale badge on; embedder label renders. |
| T-M11-09 | Compile toolkit + result summary | 2 | T-M11-03, T-M11-08 | Sticky footer with **Compile Tools** (disabled when 0 tools enabled) and **Undo Changes** (disabled when clean). Compile → `POST /api/toolkits/compile {servers:[{id,enabled,disabled_tools}]}` (`maxDuration 300` — show a long-running/determinate progress state, not a spinner that looks hung). On success: set persisted = draft, clear stale, refresh the toolkit header, and show the result — `toolCount → uniqueSelectorCount` selectors, `collisionCount` collisions, embedder label, "New chats now use this toolkit", and any `skippedServers` names in a warning tint. Handle 422 (CompileError — show `message`) and 502 (all servers unreachable). Acceptance: compiling with pending edits persists them and updates the header; the result summary matches the response; a 422/502 shows the error and leaves the draft dirty. |
| T-M11-10 | Undo draft changes | 1 | T-M11-02 | Undo resets `draft` to `persisted` and clears any compile error. Disabled when not dirty. Acceptance: after edits, Undo restores every toggle to the last-compiled state and clears the pending-change count. |
| T-M11-11 | Compact tools drawer for chat composer | 1 | T-M11-03, T-M8 | Compact variant of the console embeddable in the chat tools drawer (M8): blades + master/tool toggles + compile/undo footer, but no add-server/registry/refresh/delete affordances (matches web `compact`). Compiling here refreshes M8's `use_tools` availability. Acceptance: a user can enable tools and compile without leaving chat; the compact view omits management actions; a fresh compile makes the next `use_tools` turn use the new toolkit. |

## Out of scope / notes

- **Tool dispatch is server-side and tool-free on-device** (spec §4.3): tools
  only run through the remote `POST /api/chat` path with `use_tools` (M8). This
  epic compiles the toolkit; M8 consumes `tools.{status,turns}` in the response.
- Auth-header secrets are write-only — the API never returns them; the blade
  shows only a key icon (`hasAuth`). Never attempt to display a stored header
  value.
- Registry and MCP tool metadata are untrusted external content (spec §10) —
  render names/descriptions as plain text, never as markup.
