"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Card, CardContent } from "@/components/ui/card";
import type {
  VaultArtifact,
  VaultConnection,
  VaultMemory,
  VaultMemoryArtifactLink,
  VaultMemoryLink,
} from "@/components/vault-view";

export type GraphArtifact = Pick<VaultArtifact, "id" | "slug" | "title" | "type">;

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const MAX_NODES = 150;
const NODE_RADIUS = 5;

const TYPE_COLORS: Record<string, string> = {
  note: "#34d399",
  react: "#8b5cf6",
  jsx: "#8b5cf6",
  game: "#f472b6",
  report: "#fbbf24",
  html: "#60a5fa",
};
const DEFAULT_COLOR = "#60a5fa";
const MEMORY_COLOR = "#2dd4bf";

function colorFor(type: string): string {
  return TYPE_COLORS[type.toLowerCase()] ?? DEFAULT_COLOR;
}

type GraphNode = {
  id: string;
  title: string;
  world: "artifact" | "memory";
  slug?: string;
  type: string;
  x?: number;
  y?: number;
};

type GraphLink = { source: string; target: string; kind: "manual" | "auto" };

export function VaultGraph({
  artifacts,
  connections,
  memories = [],
  memoryLinks = [],
  memoryArtifactLinks = [],
  onMemoryClick,
}: {
  artifacts: GraphArtifact[];
  connections: VaultConnection[];
  memories?: VaultMemory[];
  memoryLinks?: VaultMemoryLink[];
  memoryArtifactLinks?: VaultMemoryArtifactLink[];
  onMemoryClick?: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const truncated = artifacts.length > MAX_NODES || memories.length > MAX_NODES;
  const graphData = useMemo(() => {
    const visibleArtifacts = artifacts.slice(0, MAX_NODES);
    const visibleMemories = memories.slice(0, MAX_NODES);
    const nodes: GraphNode[] = [
      ...visibleArtifacts.map<GraphNode>((a) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        world: "artifact",
        type: a.type,
      })),
      ...visibleMemories.map<GraphNode>((m) => ({
        id: m.id,
        title: m.title,
        world: "memory",
        type: "memory",
      })),
    ];
    const visibleIds = new Set(nodes.map((n) => n.id));
    const links: GraphLink[] = [
      ...connections.map((c) => ({ source: c.a_id, target: c.b_id, kind: c.kind })),
      ...memoryLinks.map((l) => ({ source: l.a_id, target: l.b_id, kind: l.kind })),
      ...memoryArtifactLinks.map((l) => ({ source: l.memory_id, target: l.artifact_id, kind: l.kind })),
    ].filter((l) => visibleIds.has(l.source) && visibleIds.has(l.target));
    return { nodes, links };
  }, [artifacts, connections, memories, memoryLinks, memoryArtifactLinks]);

  const typesInGraph = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of artifacts.slice(0, MAX_NODES)) {
      const t = a.type.toLowerCase();
      if (!seen.has(t)) seen.set(t, colorFor(t));
    }
    if (memories.length > 0) seen.set("memory", MEMORY_COLOR);
    return [...seen.entries()];
  }, [artifacts, memories]);

  if (artifacts.length === 0 && memories.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          Save a few artifacts or memorize some chunks and their connections will appear here.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-2">
        <div ref={containerRef} className="relative h-[520px] w-full overflow-hidden rounded-xl">
          {width > 0 && (
            <ForceGraph2D
              width={width}
              height={520}
              graphData={graphData}
              backgroundColor="rgba(0,0,0,0)"
              nodeLabel={(node) => {
                const n = node as GraphNode;
                return `${n.title} · ${n.type}`;
              }}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const n = node as GraphNode;
                if (n.x === undefined || n.y === undefined) return;
                const color = n.world === "memory" ? MEMORY_COLOR : colorFor(n.type);

                if (n.world === "memory") {
                  const r = NODE_RADIUS + 1;
                  ctx.beginPath();
                  ctx.moveTo(n.x, n.y - r - 3);
                  ctx.lineTo(n.x + r + 3, n.y);
                  ctx.lineTo(n.x, n.y + r + 3);
                  ctx.lineTo(n.x - r - 3, n.y);
                  ctx.closePath();
                  ctx.fillStyle = `${color}33`;
                  ctx.fill();
                  ctx.beginPath();
                  ctx.moveTo(n.x, n.y - r);
                  ctx.lineTo(n.x + r, n.y);
                  ctx.lineTo(n.x, n.y + r);
                  ctx.lineTo(n.x - r, n.y);
                  ctx.closePath();
                  ctx.fillStyle = color;
                  ctx.fill();
                } else {
                  ctx.beginPath();
                  ctx.arc(n.x, n.y, NODE_RADIUS + 3, 0, 2 * Math.PI);
                  ctx.fillStyle = `${color}33`;
                  ctx.fill();
                  ctx.beginPath();
                  ctx.arc(n.x, n.y, NODE_RADIUS, 0, 2 * Math.PI);
                  ctx.fillStyle = color;
                  ctx.fill();
                }

                const label = n.title.length > 26 ? `${n.title.slice(0, 25)}…` : n.title;
                const fontSize = Math.min(Math.max(12 / globalScale, 2.5), 12);
                ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillStyle = "#a1a1aa";
                ctx.fillText(label, n.x, n.y + NODE_RADIUS + 3);
              }}
              nodePointerAreaPaint={(node, color, ctx) => {
                const n = node as GraphNode;
                if (n.x === undefined || n.y === undefined) return;
                ctx.beginPath();
                ctx.arc(n.x, n.y, NODE_RADIUS + 6, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
              }}
              linkColor={(link) =>
                (link as GraphLink).kind === "auto" ? "rgba(34, 211, 238, 0.35)" : "rgba(139, 92, 246, 0.55)"
              }
              linkWidth={(link) => ((link as GraphLink).kind === "auto" ? 1 : 1.6)}
              linkLineDash={(link) => ((link as GraphLink).kind === "auto" ? [3, 3] : null)}
              onNodeClick={(node) => {
                const n = node as GraphNode;
                if (n.world === "memory" && onMemoryClick) {
                  onMemoryClick(n.id);
                  return;
                }
                const href = n.world === "memory" ? `/vault/memory?open=${n.id}` : `/a/${n.slug}`;
                window.open(href, "_blank", "noopener,noreferrer");
              }}
              cooldownTicks={120}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-2 pt-3 text-xs text-muted-foreground">
          {typesInGraph.map(([type, color]) => (
            <span key={type} className="inline-flex items-center gap-1.5">
              <span
                className={type === "memory" ? "h-2.5 w-2.5 rotate-45" : "h-2.5 w-2.5 rounded-full"}
                style={{ backgroundColor: color }}
              />
              {type}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-[rgba(139,92,246,0.8)]" /> manual
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-0.5 w-4 rounded"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg, rgba(34,211,238,0.8) 0 3px, transparent 3px 6px)",
              }}
            />
            auto
          </span>
          <span className="ml-auto">
            {truncated
              ? `Showing your ${MAX_NODES} newest per kind · scroll to zoom, drag to pan`
              : "Click a node to open it · scroll to zoom, drag to pan"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
