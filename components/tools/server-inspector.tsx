"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, Loader2, Plus, ShieldCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AuthChallenge, type AuthTarget } from "@/components/tools/auth-challenge";
import type { AddCandidate, ServerRow, ServerTool } from "@/components/tools/types";
import { cn } from "@/lib/utils";

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; name: string; tools: ServerTool[] }
  | { status: "auth"; target: AuthTarget }
  | { status: "error"; message: string };

export function ServerInspector({
  candidate,
  onCancel,
  onAdded,
  onDead,
}: {
  candidate: AddCandidate;
  onCancel: () => void;
  onAdded: (server: ServerRow, message: string) => void;
  onDead?: (url: string) => void;
}) {
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onCancel]);

  useEffect(() => {
    let cancelled = false;
    setPreview({ status: "loading" });
    setAddError(null);
    (async () => {
      try {
        const res = await fetch("/api/mcp-servers/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: candidate.url, name: candidate.name, headers: candidate.headers }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          if (data.auth_required) {
            setPreview({
              status: "auth",
              target: { url: candidate.url, name: candidate.name, registryId: candidate.registryId },
            });
            return;
          }
          if (data.dead) onDead?.(candidate.url);
          setPreview({ status: "error", message: data.error ?? "Could not inspect the server." });
          return;
        }
        setPreview({
          status: "ready",
          name: (data.name as string) ?? candidate.name ?? candidate.url,
          tools: (data.tools as ServerTool[]) ?? [],
        });
      } catch {
        if (!cancelled) setPreview({ status: "error", message: "Network hiccup — try again." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candidate, onDead]);

  async function add() {
    if (adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: candidate.url,
          name: candidate.name,
          registry_id: candidate.registryId,
          headers: candidate.headers,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.auth_required) {
          setPreview({
            status: "auth",
            target: { url: candidate.url, name: candidate.name, registryId: candidate.registryId },
          });
          return;
        }
        setAddError(data.error ?? "Could not add the server.");
        return;
      }
      onAdded(data.server as ServerRow, data.message ?? "Connected.");
    } catch {
      setAddError("Network hiccup — try again.");
    } finally {
      setAdding(false);
    }
  }

  const heading =
    preview.status === "ready" ? preview.name : candidate.name || new URL(candidate.url).hostname;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Inspect ${heading}`}
    >
      <div className="hv-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl">
        <div className="flex items-start gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">{heading}</span>
              {candidate.transport && (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {candidate.transport}
                </Badge>
              )}
              {candidate.headers && Object.keys(candidate.headers).length > 0 && (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  auth
                </Badge>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">{candidate.url}</p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="-mr-1 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {preview.status === "loading" && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Inspecting the server…
            </div>
          )}

          {preview.status === "error" && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{preview.message}</span>
            </div>
          )}

          {preview.status === "auth" && (
            <AuthChallenge target={preview.target} onConnected={onAdded} onCancel={onCancel} />
          )}

          {preview.status === "ready" && (
            <>
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>
                  {preview.tools.length === 0
                    ? "No tools exposed by this server."
                    : `${preview.tools.length} tool${preview.tools.length === 1 ? "" : "s"} exposed — review before adding.`}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {preview.tools.map((tool) => (
                  <ToolRow key={tool.name} tool={tool} />
                ))}
              </div>
            </>
          )}
        </div>

        {addError && (
          <p className="px-4 text-xs text-destructive" role="alert">
            {addError}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={adding}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={add}
            disabled={adding || preview.status !== "ready"}
          >
            {adding ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Adding…
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" /> Add server
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToolRow({ tool }: { tool: ServerTool }) {
  const [expanded, setExpanded] = useState(false);
  const params = readParams(tool.input_schema);

  return (
    <div className="rounded-xl border border-border bg-card/50">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left"
        aria-expanded={expanded}
      >
        <ChevronDown
          className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            !expanded && "-rotate-90"
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate font-mono text-xs">{tool.name}</span>
            {params.length > 0 && (
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                {params.length} param{params.length === 1 ? "" : "s"}
              </Badge>
            )}
          </span>
          {tool.description && (
            <span className={cn("text-[11px] text-muted-foreground", !expanded && "line-clamp-2")}>
              {tool.description}
            </span>
          )}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-2">
          {params.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No parameters.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {params.map((p) => (
                <li key={p.name} className="text-[11px]">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-foreground">{p.name}</span>
                    {p.type && <span className="text-muted-foreground">{p.type}</span>}
                    {p.required && <span className="text-accent">required</span>}
                  </span>
                  {p.description && <span className="text-muted-foreground">{p.description}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

type Param = { name: string; type: string | null; required: boolean; description: string | null };

function readParams(schema: Record<string, unknown> | undefined): Param[] {
  if (!schema || typeof schema !== "object") return [];
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];
  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as unknown[]).filter((r) => typeof r === "string") : []
  );
  return Object.entries(properties as Record<string, unknown>).map(([name, raw]) => {
    const def = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const type =
      typeof def.type === "string"
        ? def.type
        : Array.isArray(def.type)
          ? (def.type as unknown[]).filter((t) => typeof t === "string").join(" | ")
          : null;
    return {
      name,
      type: type || null,
      required: required.has(name),
      description: typeof def.description === "string" ? def.description : null,
    };
  });
}
