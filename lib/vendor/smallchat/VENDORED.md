# Vendored: smallchat

Semantic tool dispatch — the engine behind HyperVault's compiled tool
toolkits (`lib/smallchat/` is the only HyperVault code that imports from
this directory). The LLM expresses an intent in natural language; the
runtime resolves it to a concrete MCP tool deterministically, with a
confidence tier and an auditable resolution proof.

- **Source:** https://github.com/johnnyclem/smallchat
- **Branch:** `main`
- **Pinned commit:** `1f34adff58f9967206c55d74c8d1fe242815b7bd` (v0.5.0)
- **License:** MIT (declared in upstream `package.json`; the repo ships no
  LICENSE file at this commit)

## Why vendored instead of an npm dependency

The published `@smallchat/core` on npm is a stale 0.1.0, far behind the
0.5.0 source, and the repo has no `prepare` script — a `github:` dependency
would arrive without its `dist/`. The subset vendored here (core runtime,
compiler, hash embedder, artifact serialization) has **zero runtime
dependencies**: upstream's `better-sqlite3` / `sqlite-vec` /
`onnxruntime-node` / `commander` deps belong exclusively to modules we
exclude (SQLite artifact store, ONNX embedder, CLI, MCP server). When
upstream publishes a current build, switching to a real dependency is a
one-commit change.

## What is vendored

Only the tool-inference core and its exact import closure:

- `core/` — types, confidence, intent-pin, llm-client, manifest,
  overload-table, resolution-cache, sc-object, sc-types,
  selector-namespace, selector-table, semantic-rate-limiter, tool-class
- `runtime/` — runtime, dispatch, dispatch-builder, decomposition,
  observer, refinement, verification
- `compiler/` — compiler, parser
- `app/` — app-compiler, app-class, component-selector (imported by the
  compiler; HyperVault always compiles with `compileApps: false`)
- `embedding/` — local-embedder (hash fallback), memory-vector-index
- `mcp/` — transport (imported by tool-class), artifact (**modified**, see
  below)

Excluded: `cli/`, `channel/`, `dream/`, `importance/`, `memex/`,
`transport/`, the ONNX/SQLite/worker embedders, every other `mcp/` module
(server, router, registry, session-store, sqlite-artifact, oauth, …),
`index.ts`, `inference.ts`.

## Local modifications

1. `*.test.ts` files were excluded.
2. Relative import specifiers had their `.js` extensions stripped
   (`from './types.js'` → `from './types'`) so Next.js's bundler and this
   repo's `moduleResolution: "bundler"` tsconfig resolve them to the `.ts`
   sources.
3. `mcp/artifact.ts` was trimmed to its pure-serialization surface
   (`SerializedArtifact`, `buildArtifact`, `buildToolList`,
   `formatContent`). Upstream's `loadRuntime` / `hydrateRuntime` /
   `findManifests` were removed: they import `node:fs` and the SQLite
   store, hard-code the hash `LocalEmbedder` (breaking artifacts compiled
   with an API embedder), and hydrate `ToolProxy`s without endpoints.
   HyperVault hydrates runtimes in `lib/smallchat/runtime.ts` with the
   matching embedder and live per-server endpoints instead.

No behavioral changes were made to any other file.

## Local semantic embedder (derived, not vendored here)

Upstream's `embedding/onnx-embedder.ts` runs all-MiniLM-L6-v2 for real semantic
vectors, but it is node-only (`onnxruntime-node`) and resolves its model via
`import.meta.url` — neither survives Next's bundling or Vercel's serverless
runtime. HyperVault therefore keeps its own adaptation at
`lib/smallchat/onnx-embedder.ts` (dual runtime: `onnxruntime-node` when present,
else `onnxruntime-web` WASM; model loaded from an explicit dir traced into the
function bundle). The WordPiece tokenizer and the model files are upstream's,
unchanged:

- `lib/smallchat/models/model_quantized.onnx` — quantized all-MiniLM-L6-v2,
  SHA256 `afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1`
  (verified on load), copied from upstream `models/` at the pinned commit.
- `lib/smallchat/models/tokenizer.json` — the matching WordPiece vocab.

`resolveEmbedder` prefers a connected cloud embedding backend, then this local
MiniLM, then the hash `LocalEmbedder` (the same vendored placeholder, kept as a
last-resort fallback). To refresh the model, re-copy both files from upstream
`models/` and update the SHA256 in `onnx-embedder.ts` if it changed.

## How to refresh

```sh
git clone --depth 1 --branch main https://github.com/johnnyclem/smallchat /tmp/smallchat
cd /tmp/smallchat/src
cp core/{types,confidence,intent-pin,llm-client,manifest,overload-table,resolution-cache,sc-object,sc-types,selector-namespace,selector-table,semantic-rate-limiter,tool-class}.ts \
   $REPO/lib/vendor/smallchat/core/
cp runtime/{runtime,dispatch,dispatch-builder,decomposition,observer,refinement,verification}.ts \
   $REPO/lib/vendor/smallchat/runtime/
cp compiler/{compiler,parser}.ts $REPO/lib/vendor/smallchat/compiler/
cp app/{app-compiler,app-class,component-selector}.ts $REPO/lib/vendor/smallchat/app/
cp embedding/{local-embedder,memory-vector-index}.ts $REPO/lib/vendor/smallchat/embedding/
cp mcp/transport.ts $REPO/lib/vendor/smallchat/mcp/
find $REPO/lib/vendor/smallchat -name '*.test.ts' -delete
find $REPO/lib/vendor/smallchat -name '*.ts' -exec sed -i "s/\(from '\.[^']*\)\.js'/\1'/g" {} +
# Re-apply modification 3 to mcp/artifact.ts by hand (diff against upstream).
grep -rn "from '[^.]" $REPO/lib/vendor/smallchat --include='*.ts'  # must print nothing
```

Then update the pinned commit above and run `npm test && npm run build`.
