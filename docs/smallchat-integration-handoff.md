# Handoff: smallchat dispatch integration — findings, fixes, and results

**For:** the [smallchat](https://github.com/johnnyclem/smallchat) maintainers
**From:** HyperVault (HyperChat), which vendors smallchat's dispatch core and
drives it with real remote MCP servers in a serverless (Vercel) runtime.
**Vendored at:** `1f34adff58f9967206c55d74c8d1fe242815b7bd` (v0.5.0), subset
described in `lib/vendor/smallchat/VENDORED.md` (core / runtime / compiler /
hash embedder / artifact serialization; **not** the CLI, SQLite store, or
chat-channel layer).

This is a field report from putting the 0.5.0 dispatch core into production
against a 60–74-tool MCP toolkit (`contexta-mcp` + a Cloud Run MCP). Some of
what follows is our own integration plumbing; some is squarely in the vendored
core and worth your attention. Each item is tagged **[upstream]** (in
smallchat's own code) or **[integration]** (our layer, but the lesson may
generalize).

---

## TL;DR

| # | Area | Tag | Severity | Status (HyperVault) |
|---|------|-----|----------|---------------------|
| 1 | ONNX embedder can't load in serverless (WASM glue not bundled) | integration | blocker | Fixed (bundle tracing) |
| 2 | **Shared selector table: intents pollute the tool space** | **upstream** | **high** | Worked around in our layer; **upstream fix recommended** |
| 3 | Sub-HIGH tiers silently auto-dispatch when no `LLMClient` is set | upstream | medium | Open (design question for you) |
| 4 | Confidence + collision calibration for MiniLM / CRUD-heavy toolkits | upstream | medium | Observation, not fixed |
| 5 | Full tool catalog vs. capability map in the LLM prompt | integration | design | Changed on our side |

The headline is **#2** — it's a real correctness bug in the vendored core that
any integrator enumerating the selector table (or using `refine()`) will hit
after the first dispatch.

---

## How we use smallchat

- **Compile:** `ToolCompiler.compile(manifests)` over each user's enabled MCP
  servers, embedder = all-MiniLM-L6-v2 (ONNX) when available, else the hash
  `LocalEmbedder`. Artifact is serialized (`buildArtifact`) and frozen as an
  immutable per-user "toolkit" row.
- **Dispatch:** chat model emits a `{"intent","args"}` block; we call
  `runtime.dispatch(intent, args)`; the result (tool output, or a refinement)
  is fed back as a tool-role turn. Bounded loop (max 4 tool iterations/turn).
- **No dispatch-time `LLMClient`** is wired into the runtime — dispatch is
  purely vector similarity + our own fallbacks. (Relevant to #3.)

---

## 1. ONNX embedder can't load in a serverless function — [integration]

**Symptom.** `Compile Tools` reported the semantic model failed to load and
silently degraded every toolkit to the hash embedder (lexical-only dispatch):

```
The semantic model didn't load: no available backend found.
ERR: [wasm] Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'/var/task/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs'
imported from /var/task/node_modules/onnxruntime-web/dist/ort.node.min.mjs
```

**Root cause.** On Vercel the native `onnxruntime-node` addon is excluded
(function-size limit), so we fall back to `onnxruntime-web`. Its node entry
(`ort.node.min.mjs`) loads the actual WASM backend through a computed
`import(/*webpackIgnore:true*/ path)` — a dynamic specifier the bundler's file
tracer can't follow, so the `ort-wasm-*.mjs` glue never ships in the function.

**Fix (ours).** Trace the glue explicitly next to the `.wasm` binaries
(`next.config.ts` `outputFileTracingIncludes`). The dual-runtime
node→web fallback in our `OnnxEmbedder` (adapted from your
`embedding/onnx-embedder.ts`) is otherwise exactly right.

**For you:** if you ship the ONNX embedder as a first-class option, a note in
its docs that the `web` backend needs `ort-wasm-*.mjs` **and** `*.wasm`
force-included in traced/bundled deploys would save integrators a day. The
failure is silent (degrades to hash) unless you surface the load error — we
had to thread an `onnxDiagnostics()` channel out to the UI to even see it.

---

## 2. Shared selector table — intents pollute the tool space — [upstream] ⚠️

This is the important one.

**Symptom (in production).** After semantic dispatch went live, tool calls
started failing with:

```
That tool ("search:projects:workspace") is no longer in the toolkit.
```

`search:projects:workspace` is not a tool — it's `canonicalize("search for
projects in my workspace")`, i.e. the **user's own intent**, canonicalized.

**Root cause.** `SelectorTable` is shared between *compiled tool selectors* and
*runtime intent selectors*. `SelectorTable.resolve(intent)`
(`core/selector-table.ts`) calls `intern(embedding, canonicalize(intent))`,
which inserts the intent into the **same** `this.selectors` map **and** the
**same** vector `this.index` that hold the real tools:

```ts
// intern()
this.selectors.set(canonical, sel);   // canonical = "search:projects:workspace"
this.index.insert(canonical, embedding);
```

So the moment a dispatch happens, `selectorTable.all()` and any
`vectorIndex.search()` start returning **intent selectors alongside tools**.
Intent selectors have **no owning `ToolClass`**, so nothing can execute them.

Two concrete failure modes fall out of this:

- **Enumeration.** Any code that lists tools via `selectorTable.all()` sees
  phantom "tools". Our fallback tool-picker did exactly this, and our lexical
  rescue then "resolved" an intent to its own interned canonical — which has no
  IMP — hence `no longer in the toolkit`.
- **Refinement — this is all yours.** `refine()`
  (`runtime/refinement.ts`) builds its "did you mean?" options from
  `vectorIndex.search(selector.vector, 5, 0.3)`. After the intent is interned,
  the intent **matches itself at ~1.0**, so the top refinement option is the
  user's own intent, carrying `canonical = "search:projects:workspace"`. A
  caller that dispatches that canonical by id gets a dead tool. Even absent a
  caller, it's a nonsense top suggestion.

There's also **unbounded growth**: every distinct intent a process ever
resolves is retained forever in the shared map and vector index — memory
creep, plus steadily more self-similar noise in every subsequent search.

**Minimal repro** (pure core, no HyperVault plumbing):

```ts
const rt = /* runtime hydrated with tools create_project, list_workspaces */;
await rt.selectorTable.resolve("search for projects in my workspace");
// The interned intent now appears in the tool space:
rt.selectorTable.all().some(s => s.canonical === "search:projects:workspace"); // true
// …and refine() will offer it back as an option with no runnable IMP.
```

**Our workaround.** We gate every tool enumeration and every refinement option
on a real owning class: `runtime.context.classesForSelector(canonical).length > 0`.
That filters intent selectors out of our picker, our lexical rescue, and the
refinement options we surface. It works, but it's a bandage over a core issue
every integrator will independently rediscover.

**Recommended upstream fixes (any one closes it):**
1. **Separate the intent-resolution space from the tool space.** Give the
   dispatcher its own interning table / vector index for query vectors, kept
   distinct from the compiled tool selectors. Cleanest.
2. **Tag selector provenance** (`tool` vs `intent`) and have `all()`,
   `refine()`, and any "list tools" surface filter to `tool` by default.
3. **At minimum**, in `refine()` exclude candidates with no resolvable IMP
   (`classesForSelector(id).length === 0`) before building options, and bound
   the intent-selector cache (LRU) so it can't grow without limit.

---

## 3. Sub-HIGH tiers silently auto-dispatch without an `LLMClient` — [upstream]

**Observation.** We run dispatch with no `LLMClient` (`NULL_LLM_CLIENT`). In
`runtime/dispatch.ts`:

- **LOW** (`>= 0.60`) → `requiresDecomposition` → `decompose(...)` returns
  *not decomposed* (no LLM) → the code comments "fall through to dispatch best
  match" and **executes the top candidate**.
- **MEDIUM** (`>= 0.75`) → `verify(...)` runs with `skipLLMCheck: true` (no
  `microCheck`), i.e. schema-only — effectively a pass, then dispatch.

Net effect: **without an LLM client, every tier `>= 0.60` auto-executes the
best vector match.** We saw a real mis-fire: intent "list my projects" scored
`create_project` in the LOW band and **called it** (it failed only because a
required arg was missing). For a read tool that's harmless; for a
write/destructive tool a 0.60 mismatch that auto-runs is a footgun.

This is arguably by design (the Pillars degrade gracefully when their LLM
dependency is absent), but the *safe-looking* tiers (verify / decompose /
refine) quietly become *no-ops* that fall through to execution. Two things
would help integrators who don't wire an LLM:

- A runtime flag like `treatLowAsRefinement` / `requireLLMForSubHighDispatch`
  so that, absent an `LLMClient`, sub-HIGH resolutions return a **refinement**
  (ask the user) instead of executing.
- Or: when `llmClient === NULL_LLM_CLIENT` and `tier` is LOW, return a
  refinement rather than "dispatch best match." Document the chosen behavior
  prominently — it materially changes safety.

**Status:** open on our side; we're considering a guard in our route that
converts LOW-tier resolutions on write-classified tools into a user
confirmation. Would prefer a first-class knob from you.

---

## 4. Confidence + collision calibration for MiniLM / CRUD-heavy toolkits — [upstream]

Two calibration observations from a real 74-tool toolkit:

- **Everything reasonable lands in LOW.** With all-MiniLM-L6-v2, clear
  paraphrases scored **0.60–0.74** against the correct tool ("list my projects"
  → `list_workspaces` 0.74, `get_workspace_tree` 0.61 — both correct, both
  "LOW"). The `DEFAULT_THRESHOLDS` (`exact .95 / high .85 / medium .75 / low
  .60`, `core/confidence.ts`) look tuned for a higher-contrast embedding space;
  for MiniLM cosines they push almost all real matches into the tier that (per
  #3) auto-dispatches or, worse, refines. Recommend either shipping
  MiniLM-specific default thresholds or documenting a recommended override for
  it.

- **Collision counts explode on CRUD-shaped MCP tools.** Compiling 74 tools
  reported **56 collisions**. MCP servers tend toward many near-synonymous
  tools (`manage_task`, `get_task`, `list_tasks`, `bulk_update_tasks`,
  `manage_task_relations`…), and the compile-time embedding text is
  `name: description` (`compiler.ts`), which makes them highly self-similar. The
  collision *firewall* (0.75–0.95, `compiler.ts`) is a genuinely useful signal —
  but at 56/74 it's more noise than a user can act on. Worth considering:
  richer embedding text (include arg names / a category hint), or grouping
  collisions into clusters in the report rather than pairwise.

Neither is a bug; both are "the defaults don't fit this workload out of the
box." Happy to share the anonymized manifest if useful.

---

## 5. Full tool catalog vs. capability map in the LLM prompt — [integration]

Not smallchat's code, but a philosophy note since it's central to the pitch.
We were injecting a **per-tool** capability list into the chat system prompt
(one line per tool, grouped by server). With 60–70 tools the model happily
enumerated the whole catalog back to the user and over-indexed on it — the
"everything's a nail" failure, and the opposite of "no tool lists stuffed into
context."

We switched to a compressed **capability *map***: one line per server naming
the domain *areas* it covers (66 tools → 2 lines), so the model reasons about
the user's goal and hands the dispatcher a plain intent. This felt much closer
to smallchat's intended contract (the *dispatcher* chooses the tool, not the
reasoning model). If you offer a reference "capability header" for integrators,
we'd suggest it default to areas/categories, not an enumerated tool list.

---

## What worked well 👍

- **Semantic dispatch is genuinely good once MiniLM loads.** Paraphrases
  resolve to the right tool, and multi-hop reasoning works: "list my projects"
  correctly drove `list_workspaces` → `get_workspace_tree` and produced an
  accurate synthesized answer with no exact tool names in play.
- **The resolution proof + confidence tiers are excellent for debugging.** We
  surface tier + confidence per tool call in our UI; being able to see "LOW
  61% → get_workspace_tree" made every issue in this doc diagnosable from the
  product surface.
- **Collision detection at compile time is a real asset** — it surfaced
  genuinely duplicative tools we'd have missed.
- **Selector dedup (0.95)** correctly merges true duplicate tools.
- **The refinement → user-picker model is the right UX** once the pollution in
  #2 is removed; the "did you mean?" options are well-shaped.
- **Zero-runtime-dependency core** made vendoring painless — the subset we use
  has no `better-sqlite3` / `onnxruntime-node` / `commander` baggage.

---

## Suggested priorities for upstream

1. **#2 selector-table pollution** — correctness bug, hits every integrator.
   Separate intent vs tool selector spaces (or filter + bound the cache).
2. **#3 sub-HIGH auto-dispatch without an LLM** — make the safe behavior the
   default, or give integrators a flag. This is a safety issue for write tools.
3. **#4 threshold/collision calibration for MiniLM + MCP** — ship better
   defaults or document overrides; the current defaults degrade quietly.
4. Doc notes for the ONNX `web` backend in bundled/serverless deploys (#1) and
   a category-style reference capability header (#5).

---

## References

- Vendored core: `lib/vendor/smallchat/` (`VENDORED.md` for the exact subset).
- Our integration layer: `lib/smallchat/` (compile, hydrate, embedder,
  fallback, intent protocol) and `app/api/chat/route.ts` (dispatch loop).
- Fixes referenced here landed in HyperVault PRs #96 (ONNX bundling), #97
  (selector-table pollution workaround + picker escape hatch), #98 (capability
  map). Happy to walk any of them through with you.
