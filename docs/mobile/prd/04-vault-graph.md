# M4 — Vault Graph

**Status:** Draft for implementation handoff
**Epic:** M4 · Vault Graph
**Depends:** M3 (vault list, artifact fetch, WebView open)

Read [`../00-engineering-spec.md`](../00-engineering-spec.md) (§9 names the
native-graph substitution for the web's `react-force-graph-2d`) and
[`00-index.md`](./00-index.md) first — inherited conventions are not repeated.

## Goal

A native force-directed graph of the vault — artifacts and memories as nodes,
manual/auto connections as edges — reachable from a List⇄Graph toggle on the
vault screen. It reproduces the web `VaultGraph`: node color by artifact type,
memory diamonds, manual-solid-purple / auto-dashed-cyan edges, a 150-per-kind
cap, zoom/pan, tap-to-open, and a legend — while honoring reduced-motion.

## User stories

- As a user I flip my vault between a list and a graph.
- As a user I see my artifacts and memories as a connected map, colored and
  shaped so the two worlds and each artifact type read apart at a glance.
- As a user I tell manual connections from auto ones by their edge style.
- As a user I pinch to zoom and drag to pan the graph.
- As a user I tap a node to open it — an artifact in the WebView, a memory in
  its detail screen.
- As a user with reduced-motion on, the graph settles without a churning
  animation.

## Tasks

| ID | Title | Pts | Depends | Description / Acceptance |
| --- | --- | --- | --- | --- |
| T-M4-01 | Choose + scaffold the graph renderer | 2 | M3 | Stand up the graph surface per spec §9: **`react-native-skia` + `d3-force`** (draw nodes/edges to a Skia canvas, run the sim in JS) or a **WebView-hosted force-graph** (reuse `react-force-graph-2d` via `postMessage`). Decide once, document the choice, and expose a `<VaultGraph>` component taking the same inputs as the web one. Renders an empty canvas that resizes to its container. |
| T-M4-02 | Assemble graph data | 2 | T-M4-01 | Build `{ nodes, links }` from `GET /api/artifacts` (artifact nodes: `id, slug, title, type`, world "artifact"), the user's memories (world "memory"; source per M6), and `GET /api/connections` → `connections`, `memory_links`, `memory_artifact_links`. Links map to `{ source, target, kind }` and are filtered to edges whose both endpoints are visible nodes. Reuse the M3 vault feature store's artifact + connection fetch. |
| T-M4-03 | Artifact node encoding | 1 | T-M4-02 | Artifacts drawn as circles colored by lowercased `type`: note `#34d399` (green), react/jsx `#8b5cf6` (purple), game `#f472b6` (pink), report `#fbbf24` (amber), html + any unrecognized type `#60a5fa` (blue). Each node has a soft glow halo and a truncated title label below it (≤ 25 chars + "…"), label size scaling with zoom. |
| T-M4-04 | Memory node encoding | 1 | T-M4-02 | Memories drawn as **diamonds** in teal `#2dd4bf` (with the same glow treatment) so the wiki side reads apart from artifact circles even zoomed out. |
| T-M4-05 | Edge styles | 1 | T-M4-02 | Manual edges: solid purple `rgba(139,92,246,0.55)`, width ~1.6. Auto edges: dashed cyan `rgba(34,211,238,0.35)`, dash `[3,3]`, width ~1. Applies uniformly to artifact–artifact, memory–memory, and memory–artifact links. |
| T-M4-06 | Zoom & pan | 2 | T-M4-03, T-M4-04, T-M4-05 | Pinch-to-zoom and drag-to-pan gestures over the canvas, with sensible min/max zoom. Nodes/labels stay legible across zoom. (In the WebView variant, the hosted force-graph's own zoom/pan; in the Skia variant, a gesture handler transforming the world.) |
| T-M4-07 | 150-per-kind cap + "showing newest" note | 1 | T-M4-02 | Cap at 150 artifact nodes and 150 memory nodes (newest first, matching the data order); drop links whose endpoints fell outside the cap. When either kind is truncated, the footer reads "Showing your 150 newest per kind · pinch to zoom, drag to pan"; otherwise "Tap a node to open it · pinch to zoom, drag to pan". |
| T-M4-08 | Tap-to-open | 1 | T-M4-06 | Tapping an artifact node opens `/a/<slug>` in the sandboxed WebView (M3 T-M3-10). Tapping a memory node opens its detail screen in M6 (until M6 lands, route to a placeholder / no-op with a "coming in Memory" affordance). Hit target is generous (larger than the drawn node). |
| T-M4-09 | Legend | 1 | T-M4-03, T-M4-04, T-M4-05 | Legend below the canvas listing only the artifact types actually present (colored dot per type) plus a teal diamond for "memory" when any memory is shown, and the two edge swatches: solid = "manual", dashed = "auto". |
| T-M4-10 | Empty state | 1 | T-M4-02 | With no artifacts and no memories, show "Save a few artifacts or memorize some chunks and their connections will appear here." instead of an empty canvas. |
| T-M4-11 | List⇄Graph toggle on the vault screen | 1 | T-M4-01, M3 | Segmented control at the top of the vault screen switching between the M3 list and this graph (mirrors the web `VaultView` toggle), with the "＋ New from chat" action alongside. Selection state is local; both views read the same feature store. |
| T-M4-12 | Reduced-motion + a11y | 1 | T-M4-06 | Honor the OS reduced-motion setting: pre-settle the layout (run the sim headless / short cooldown and render the resting positions) rather than animating a live churn. Provide a screen-reader summary (node/edge counts, truncation note) since a canvas isn't natively traversable; ensure the toggle and legend are labeled. |

## Out of scope / notes

- Editing the graph (creating/removing edges) is **M5** — this epic is
  read/visualize + navigate only.
- Memory nodes and their detail destination depend on **M6**; graph data can
  include memories before M6 ships, but tap-to-open a memory is stubbed until
  the memory detail screen exists.
- Keep the encodings byte-for-byte with the web (`components/vault-graph.tsx`):
  same hex colors, same 150 cap, same manual/auto semantics — the graph is a
  shared visual language across web and phone.
</content>
