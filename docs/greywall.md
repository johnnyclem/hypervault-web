# Running HyperVault with greywall

[Greywall](https://github.com/johnnyclem/greywall) is a container-free,
deny-by-default sandbox for AI coding agents: kernel-enforced isolation
(bubblewrap + Landlock + seccomp on Linux, Seatbelt on macOS), a transparent
network proxy (greyproxy) that owns all domain filtering, and an
allow-all observability mode (`greywatch`). HyperVault meets greywall in two
places: the MCP server runs *inside* the sandboxes greywall creates, and a
self-hosted HyperVault deployment can itself run *under* greywall for egress
control.

## 1. hypervault-mcp inside a greywall sandbox

When you run an agent under greywall (`greywall -- claude`), every MCP server
that agent spawns — including `hypervault-mcp` — runs inside the same sandbox.
hypervault-mcp is built to survive that:

- **Single-host by design.** Every tool call, including
  `extract_source_prompt`, goes to the API origin only (`hypervault.store`,
  or whatever `HYPERVAULT_API_URL` points at). `extract_source_prompt`
  resolves artifact URLs through `GET /api/extract` on the backend instead of
  fetching vanity-domain pages directly, so you allowlist exactly one domain
  in greyproxy — not the whole vanity portfolio. (Against backends that
  predate `/api/extract`, the tool falls back to fetching the artifact page
  directly; that legacy path needs the artifact's own domain allowed too.)
- **No filesystem or exotic syscall needs.** The server reads nothing but the
  Python runtime and writes nothing, so greywall's `python` toolchain profile
  covers it.
- **Header-borne auth.** The API key travels in the `X-HyperVault-Key` HTTP
  header, which is exactly the shape greywall's credential protection
  understands: mark `HYPERVAULT_API_KEY` as a secret and the sandboxed
  process only ever sees a placeholder — greyproxy substitutes the real key
  into the header at the proxy boundary, so a misbehaving agent can't read or
  exfiltrate it.

Quickstart (see [`mcp-server/greywall.json`](../mcp-server/greywall.json) for
the settings template):

```bash
export HYPERVAULT_API_KEY=hv_...
greywall --profile claude,python --settings mcp-server/greywall.json -- claude
```

Then allow the HyperVault API host (`hypervault.store` by default) in the
greyproxy dashboard. To audit before locking down, run the same command with
`greywatch` (or `greywall --watch`) and watch what the agent actually touches.

## 2. Self-hosted HyperVault under greywall (chat egress hardening)

The hosted app runs on Vercel, where kernel sandboxing isn't applicable. But a
self-hosted HyperVault server is a worthwhile thing to sandbox: it holds
AES-256-GCM-encrypted LLM provider keys that *it can decrypt*
(`lib/backends/crypto.ts`), and `/api/chat` makes outbound calls to whichever
backends users configure. Running the server under greywall pins its egress to
exactly the hosts it should talk to.

```bash
greywall --profile node -- npm run start    # or: greywatch -- npm run dev  (audit first)
```

Allow these in greyproxy, matching the built-in provider registry
(`lib/backends/providers.ts`) plus your own infrastructure:

| Host | Why |
| --- | --- |
| `<your-project>.supabase.co` | Database + auth |
| `api.openai.com` | OpenAI backends |
| `api.anthropic.com` | Anthropic (Claude) backends |
| `api.x.ai` | xAI (Grok) backends |
| `generativelanguage.googleapis.com` | Google (Gemini) backends |
| `api.mistral.ai` | Mistral backends |

Notes:

- **Local backends** (Ollama on `localhost:11434`, LM Studio on
  `localhost:1234`) need local outbound enabled
  (`"network": { "allowLocalOutbound": true }`).
- **Custom backends**: any OpenAI- or Anthropic-compatible endpoint a user
  connects has to be allowed explicitly — which is a feature: a self-hoster
  controls exactly which third-party hosts their users' chat traffic (and
  decrypted keys) can ever reach.
- **Inbound**: expose the app port with `-p 3000`.

## Follow-ups (not in this pass)

- **Agent audit trail → vault memory**: piping greywatch violation/session
  events into `memorize()` would make the vault a permanent record of what
  your agents did. Blocked on greywall exposing a machine-readable event
  stream; today the events live in the greyproxy dashboard.
- **A `hypervault` entry in greywall's built-in profiles**, so
  `greywall -- claude` recommends the right policy automatically when it
  detects hypervault-mcp in the agent's MCP config. Belongs in the greywall
  repo.
