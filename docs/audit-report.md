# HyperVault Security & Architecture Audit — August 2026

Scope: full-repo code review, security audit, dependency/toolchain hygiene, and
targeted technical-debt reduction, performed on `claude/code-review-security-audit-1zk108`
against `main` (commit `da859b5`). Process: seven parallel research passes
(auth/authz, secrets/crypto, API input validation, Supabase RLS/schema,
dependency health, architecture/tests/docs, MCP-server/import security),
synthesized and then verified by direct code reading before any fix — two
research findings turned out to be false positives on verification and are
called out below rather than silently dropped.

## Summary

HyperVault's security posture was already reasonably strong going in: AES-256-GCM
used correctly and consistently everywhere secrets are stored, GitHub webhook
HMAC verification with `timingSafeEqual`, API keys hashed and looked up by DB
equality, admin gating that fails closed, strict TypeScript with no suppressed
build errors, and a real (713-test) suite that was passing but never run in CI.
The issues found were concentrated in a few specific gaps rather than systemic
problems: two SSRF holes (one in a codebase that already had the right guard
pattern elsewhere, just not reused), a fail-open authorization check, an
unauthenticated network listener in the companion MCP server, and thin rate
limiting on the routes that most needed it.

**7 findings fixed** (2 Critical, 3 High, 2 High/Medium SSRF pair) · **7
dependency updates applied** (1 major CVE remediation + patch/minor refresh +
2 deliberate compatibility-driven majors) · **2 research findings corrected**
on verification · **Medium/Low findings documented below with rationale**,
left alone this pass per "prefer non-breaking changes" and "no large
speculative rewrites."

All fixes verified with `tsc --noEmit`, the full vitest suite, and
`next build`; the two SSRF fixes and the MCP HTTP auth fix were additionally
verified live (a running server hit with curl/monkeypatched `httpx`), not just
by unit test.

---

## Findings

### Critical

**C1. SSRF in MCP server introspection** — Fixed (`e23b4f8`).
`app/api/mcp-servers/route.ts`, `preview/route.ts`, `[id]/refresh/route.ts`,
and both `oauth/*` routes all funnel into `introspectMcpServer()`, which
validated URLs with only `/^https?:\/\//` before fetching them server-side —
no private-IP/hostname blocklist, unlike the equivalent guard
(`isBlockedHost`/`checkPublicHttpUrl`) already implemented in
`lib/ingest/web.ts` for URL imports. `introspectMcpServer()` now reuses that
guard, and `McpHttpClient` now fetches with `redirect: "error"` so a
validated public URL can't 3xx to an internal address after the check passes.
Tests added in `lib/smallchat/__tests__/{introspect,jsonrpc}.test.ts`.

### High

**H1. `getAccess()` fails open on a DB error** — Fixed (`ed05fdc`).
`lib/access.ts` — the gate behind `/vault`, `/chat`, `/tools`, and every other
invite-gated page — returned `approved: true` when the `account_access`
lookup errored twice in a row. A transient Postgres hiccup granted un-invited
users full app access. Now fails closed, matching `requireAdmin()`'s posture.
Added `lib/__tests__/access.test.ts` (previously untested).

**H2. MCP server's HTTP transport had no authentication** — Fixed (`1287a98`).
`mcp-server/src/hypervault_mcp/server.py` called `mcp.run(transport="http",
...)` with FastMCP's `auth=` parameter unused. `HYPERVAULT_API_KEY` gates
*this server's* calls to the HyperVault backend but was never checked
per-caller, so anyone reaching the port got every tool — including
`delete_vault_item`, `write_artifact`, `forget_memory` — with zero
credentials of their own. The module's own docstring/README example shows
`--host 0.0.0.0` for "web agents," making this reachable by design in the
documented deployment. Fixed by gating the transport with a
`StaticTokenVerifier` built from `HYPERVAULT_API_KEY` itself (so callers must
send `Authorization: Bearer <key>`), and `main()` now refuses to start
`--transport http` at all if the key isn't set. STDIO is unaffected (FastMCP
skips auth checks for stdio regardless of configuration — verified via
source). Bumped the `fastmcp` floor to `>=2.11.3` (the earliest version with
`StaticTokenVerifier`, confirmed empirically). Verified live: no-auth → 401,
wrong token → 401, correct token → a real MCP `initialize` handshake (200);
STDIO handshake still works unauthenticated as before.

**H3 (paired with C1, Medium on its own). SSRF in `extract_source_prompt`'s
legacy fallback** — Fixed (`4a595ea`). Same MCP server. The tool tries the
backend's `/api/extract` first (which only ever reads an artifact from
Postgres by slug — no outbound fetch, already safe — and 400s any
non-HyperVault URL), then falls through to a raw `httpx.get(cleaned,
follow_redirects=True)` on the caller-supplied URL on any error. That fallback
is live for *any* non-HyperVault URL today, not just legacy deployments as the
name implies. Added `_is_blocked_host()` (Python port of `isBlockedHost`,
using `ipaddress.ip_address` for correct IPv4/IPv6 classification) and
`_fetch_public_url()`, which re-validates the host on every redirect hop
manually instead of trusting `httpx`'s `follow_redirects`. This is this
package's first test suite (`mcp-server/tests/`, 20 tests, `pytest` via a new
`[dev]` extra).

**H4. Rate limiting gaps** — Fixed (`dec4b29`). Only 4 of ~70 API routes
called `rateLimit()` (`memories/import`, `keys`, `invite/redeem`,
`claim-domain`). Added it to `chat` (30/min), `save` (30/min), `import`
(30/min — sized to accommodate the ~15 sequential chunked POSTs a single large
Grok/X export can legitimately generate per `lib/imports/chunk.ts`),
`registry/search` (60/min), `toolkits/compile` (20/min), and both
`mcp-servers` routes that call the now-SSRF-guarded `introspectMcpServer`
(20/min each — rate limiting narrows the probe window even with the host
guard in place). Test added confirming `mcp-servers/preview` 429s under
repeated calls.

**Not fixed — noted as a false positive.** The research pass flagged
`api_keys`'s `update_own` RLS policy as missing a `WITH CHECK` clause
(`supabase/migrations/0001_init.sql:99`). On verification: Postgres's RLS
semantics implicitly reuse the `USING` clause as `WITH CHECK` for `UPDATE`
policies when no explicit `WITH CHECK` is given, so this was never actually
exploitable — no fix needed, no migration added.

**Not fixed — noted as a false positive.** The research pass flagged
`invite_codes` as "RLS never enabled" (`supabase/migrations/0011_invite_gate.sql`).
On verification: line 26 of that exact file enables RLS on `invite_codes`
alongside `account_access` and `waitlist`. With RLS enabled and zero policies
defined, PostgREST denies all access by default — the correct, secure
posture (same pattern intentionally used for `mcp_dead_endpoints` and
`github_stargazers`). The research agent misread the file; no fix needed.

### Medium — documented, deliberately deferred this pass

These are real, worth doing, but each is either a broader refactor than "small,
reviewable" allows, or a judgment call that benefits from the app owner's input
rather than a unilateral bump:

- **API-key auth skips invite/waitlist re-validation** (`lib/api-auth.ts`) —
  a de-invited user's existing API key keeps working indefinitely, since only
  the bearer-JWT and cookie-session auth paths call `passesInviteGate`.
  Recommend: apply the same gate to the API-key path, or explicitly document
  that key revocation is the intended de-provisioning mechanism instead.
- **Secrets-encryption key falls back to `SUPABASE_SERVICE_ROLE_KEY`** when
  `HYPERVAULT_KEY_SECRET` is unset (`lib/backends/crypto.ts`) — functionally
  safe today (still a real, high-entropy secret) but couples two unrelated
  concerns and creates a silent rotation hazard. Recommend: fail startup in
  production if `HYPERVAULT_KEY_SECRET` is unset, rather than silently
  falling back.
- **Raw Supabase `error.message` returned to clients** across many routes
  (`admin/invites`, `jobs`, `conversations`, `secrets`, `digest`,
  `mind/branches`, and others) — minor internal-schema information
  disclosure (table/column/constraint names). Fixing this properly means a
  shared "log full error server-side, return a generic message client-side"
  helper threaded through ~15+ routes — a real but wide-surface change,
  scoped out of this pass.
- **The `next@16` upgrade** would close the remaining 3 high-severity
  `npm audit` findings (postcss, sharp — both only reachable via Next's
  built-in image optimization and CSS source-map handling, neither of which
  this app currently exercises: no `next/image` usage found anywhere, and
  postcss only runs at build time on this repo's own Tailwind CSS, never on
  untrusted input). Left as a deliberate, reviewed decision rather than
  bundled into this pass — recommend scheduling it as its own PR with a full
  App Router smoke test, since Next major versions routinely carry real
  breaking changes.
- **`lib/ratelimit.ts` is in-memory/per-process** — real but weaker
  protection on serverless (each cold instance starts a fresh counter).
  Rate limiting was extended to the routes that needed it this pass (H4
  above) using the existing mechanism; moving to a shared KV/Redis-backed
  limiter is a larger, independently-schedulable change.
- **`typescript@7` and `@types/node@26`** intentionally not bumped.
  TypeScript 7 is the native/Go-ported compiler rewrite, not a routine major
  — a different toolchain, not a drop-in bump. `@types/node@26` implies a
  Node 26 API surface that doesn't match this app's actual floor (see the new
  `engines` field, `>=20.0.0`); bumping the types without knowing the real
  deployed Node version would be misleading rather than helpful.
- **Several tables** (`llm_backends`, `mcp_servers`, `toolkits`,
  `user_secrets`, `secret_grants`) **define only `select`/`delete` RLS
  policies**, no `insert`/`update` — safe today because all writes go
  through the service-role admin client server-side (verified: every
  non-test usage of the admin client is in server-only code, scoped by an
  authenticated `user.id`, never client-callable). Flagged as a schema smell
  for future maintainers, not a current hole.
- **Duplicate/overlapping migrations** (e.g. `0002_source_prompt.sql` +
  `0002_connections.sql` vs `0002_source_prompt_and_connections.sql`;
  `0012_subdomain_themes.sql` and `0016_chat_memory_privacy.sql` both adding
  the same `domain_claims.theme` column) — harmless (idempotent `if not
  exists`/`drop policy if exists`) but signals the migration history was
  never squashed. No functional risk; noted for hygiene only.

### Low — noted, not actioned

- No pre-parse size guard before `mammoth`/`unpdf` parsing beyond the
  general upload cap; zip-import decompression-bomb protection is minimal
  (self-DoS only, client-side, low impact).
- `middleware.ts` silently no-ops when Supabase env vars are partially
  unset — degrades safely (downstream `getUser()`/`requireAdmin()` also
  no-op/fail closed), just inconsistent rather than dangerous.
- `toolkits/compile` doesn't validate `id` shape before querying (scoped by
  `user_id` regardless, so not exploitable — just imprecise).
- `lib/memory.ts`/`lib/recall.ts` mix pure text-processing helpers with
  side-effecting DB calls in the same module — minor separation-of-concerns
  smell, not a bug.
- TODO/stub code exists (gRPC transport stub, LLM-disambiguation stub,
  zero-vector embedder) but is entirely confined to vendored packages
  (`lib/vendor/short-hand`, `lib/vendor/smallchat`), not first-party code.

---

## Dependency & toolchain changes

| Change | Commit | Why |
| --- | --- | --- |
| `next` 15.1.3 → 15.5.23 | `f35b2a6` | Resolves the npm-audit DoS/cache-confusion chain in Server Actions handling |
| `adm-zip` pinned `>=0.6.0` via override | `f35b2a6` | Closes a 4GB-allocation DoS (`GHSA-xcpc-8h2w-3j85`); no non-prerelease `onnxruntime-node` release drops the vulnerable transitive dep yet |
| In-range patch/minor refresh (`@supabase/supabase-js`, `tailwindcss`, `@types/react`, `@types/react-dom`, `react`, `react-dom`, `mammoth`, `unpdf`) | `4723202` | Routine `npm update` within existing semver ranges |
| `@supabase/ssr` 0.6.1 → 0.12.4 | `07d1118` | 0.12.3 fixed domain-scoped cookie deletion — directly relevant, since this app scopes session cookies per-host for vanity subdomains |
| `tailwind-merge` 2.6 → 3.6 | `6e6b712` | v3.x is specifically the line that added Tailwind CSS v4 support; this app has been on Tailwind v4 the whole time with a merge library that didn't fully understand it |
| `lucide-react` 0.469 → 1.31 | `263e77c` | Major version behind; all 29 icon imports across 15 files resolved cleanly (tsc + build), so no breakage from renamed/removed icons |
| `engines.node >=20.0.0` added | `996130a` | Nothing previously documented/enforced a Node version |
| `mcp-server/uv.lock` added | `3888703` | Python package had zero lockfile — every install could silently resolve different transitive versions |

**Remaining `npm audit` findings (3 high, all in the postcss/sharp chain):**
only clear with `next@16`, deliberately deferred (see Medium section above).

**Migration notes for whoever picks up `next@16` next:** run the full App
Router route list through a smoke test (this repo has zero route-level
integration tests for several subsystems — see below), check
`next.config.ts` for any option renamed/removed in v16, and re-run `npm
audit` afterward to confirm the postcss/sharp chain actually clears.

---

## Test coverage gaps (not closed this pass, worth flagging)

713 → now 726+ tests pass (additions from this audit: `lib/access.test.ts`,
SSRF guard tests, mcp-server's first test suite), but coverage is
concentrated in `lib/`. There are still no route-level integration tests for
`app/api/chat/**` (the highest-traffic, most complex route — 559 lines,
tool dispatch, multi-backend orchestration), `app/api/mind/**`,
`app/api/dreams/**`, `app/api/digest/**`, `app/api/memories/**`, or
`app/api/backends/**`. Recommend prioritizing `chat` first given its size
and blast radius.

**No CI exists** — no `.github/workflows`, so `lint`/`test`/`build` never run
automatically on push or PR despite a real, now-larger test suite existing.
This is arguably the highest-leverage single follow-up: wiring up CI would
have caught nothing in this specific audit (everything here needed a human
security read), but it locks in every fix made here against silent
regression going forward.

---

## Recommended next steps, in order

1. Wire up CI (lint + test + build on every PR) — cheapest, highest-leverage
   change not made in this pass.
2. Schedule the `next@16` upgrade as its own reviewed PR with a full route
   smoke test; it's the last blocker on a clean `npm audit`.
3. Apply the invite-gate check to the API-key auth path, or explicitly
   document that key revocation is the intended de-provisioning mechanism.
4. Require `HYPERVAULT_KEY_SECRET` at startup in production rather than
   silently falling back to the service-role key.
5. Add route-level tests for `app/api/chat/**` first, then the other
   untested subsystems.
6. If/when time allows: a shared helper for "log full Supabase error
   server-side, return generic message client-side," applied incrementally
   rather than as one large diff.
