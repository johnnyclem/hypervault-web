# Vendored: short-hand

Progressive context compaction for LLMs — the engine behind vault chat's
"Smart context" feature (`lib/shorthand/compact.ts` is the only HyperVault
module that imports from this directory).

- **Source:** https://github.com/johnnyclem/short-hand
- **Branch:** `main`
- **Pinned commit:** `d8eb635594abe62c38958e950eebfbaeb36d8c15`
- **License:** MIT (see `LICENSE` in this directory)

## Why vendored instead of an npm dependency

short-hand is not published to npm, and the repo ships TypeScript source
without a build step — a `github:` dependency would need an install-time
compile to work on Vercel. The library has **zero runtime dependencies**, so
its `src/` compiles cleanly as part of this app. When upstream publishes a
built release, switching to a real dependency is a one-commit change.

## Local modifications

Two mechanical transforms were applied at copy time (no behavior changes):

1. `*.test.ts` files were excluded.
2. Relative import specifiers had their `.js` extensions stripped
   (`from './types.js'` → `from './types'`) so Next.js's bundler and this
   repo's `moduleResolution: "bundler"` tsconfig resolve them to the `.ts`
   sources.

## How to refresh

```sh
git clone --depth 1 --branch main https://github.com/johnnyclem/short-hand /tmp/short-hand
rm -rf lib/vendor/short-hand/{benchmark,compaction,crdt,embedding,importance,ingestion,interpreter,verification,wiki,index.ts,types.ts,utils.ts}
cp -r /tmp/short-hand/src/* lib/vendor/short-hand/
cp /tmp/short-hand/LICENSE lib/vendor/short-hand/LICENSE
find lib/vendor/short-hand -name '*.test.ts' -delete
find lib/vendor/short-hand -name '*.ts' -exec sed -i "s/\(from '\.[^']*\)\.js'/\1'/g" {} +
```

Then update the pinned commit above and run `npm test && npm run build`.
