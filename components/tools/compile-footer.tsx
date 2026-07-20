"use client";

import { useState } from "react";
import { Hammer, Info, Undo2, X } from "lucide-react";
import type { ServerDraft } from "@/components/tools/types";
import { countPendingChanges } from "@/components/tools/types";
import { cn } from "@/lib/utils";

export type CompileResult = {
  toolkitId: string;
  stats: {
    toolCount: number;
    uniqueSelectorCount: number;
    providerCount: number;
    collisionCount: number;
  };
  embedderLabel: string;
  embedderDegradeReason?: string | null;
  skippedServers: Array<{ id: string; name: string; error: string }>;
};

export function CompileFooter({
  draft,
  persisted,
  dirty,
  compiling,
  result,
  error,
  compact = false,
  onCompile,
  onUndo,
}: {
  draft: ServerDraft[];
  persisted: ServerDraft[];
  dirty: boolean;
  compiling: boolean;
  result: CompileResult | null;
  error: string | null;
  compact?: boolean;
  onCompile: () => void;
  onUndo: () => void;
}) {
  const enabledTools = draft.reduce(
    (n, s) => n + (s.enabled ? s.tools.filter((t) => !s.disabledTools.includes(t.name)).length : 0),
    0
  );
  const pending = countPendingChanges(draft, persisted);
  const [explainerOpen, setExplainerOpen] = useState(false);

  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 -mx-px rounded-b-2xl border-t border-border bg-background/95 backdrop-blur",
        compact ? "px-3 py-2.5" : "px-4 py-3"
      )}
    >
      {explainerOpen && (
        <div
          className="mb-3 rounded-xl border border-border bg-card/60 p-3 text-xs leading-relaxed text-muted-foreground"
          role="region"
          aria-label="What Compile Tools does"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="font-semibold text-foreground">What does Compile Tools do?</span>
            <button
              type="button"
              onClick={() => setExplainerOpen(false)}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close explanation"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mb-2">
            HyperVault runs your MCP tools through <span className="font-medium text-foreground">smallchat</span>, a
            semantic dispatch engine. Instead of exposing every raw tool to the model, it compiles your enabled tools
            into a compact <span className="font-medium text-foreground">toolkit</span> of searchable{" "}
            <span className="font-medium text-foreground">selectors</span>.
          </p>
          <p className="mb-2">
            At chat time the model expresses what it wants in plain language, and smallchat resolves that intent to a
            concrete tool deterministically — with a confidence tier and an auditable resolution proof — rather than the
            model guessing tool names and arguments. This keeps prompts smaller and dispatch more reliable as you
            connect more servers.
          </p>
          <p>
            Toggling servers and tools only edits a local draft — <span className="font-medium text-foreground">nothing
            applies until you hit Compile Tools</span>, which rebuilds the toolkit so new chats use it.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">
          {error ? (
            <span className="text-destructive" role="alert">
              {error}
            </span>
          ) : compiling ? (
            <span>Compiling {enabledTools} tools…</span>
          ) : dirty ? (
            <span>
              {pending} change{pending === 1 ? "" : "s"} pending — compile to apply.
            </span>
          ) : result ? (
            <span>
              {result.stats.toolCount} tools → {result.stats.uniqueSelectorCount} selectors ·{" "}
              {result.stats.collisionCount} collision{result.stats.collisionCount === 1 ? "" : "s"} ·{" "}
              {result.embedderLabel}. New chats now use this toolkit.
              {result.embedderLabel.includes("lexical") && (
                <span className="text-amber-500">
                  {" "}Lexical matching only — clear intents can miss and fall to the tool picker.
                  {result.embedderDegradeReason
                    ? ` The semantic model didn't load: ${result.embedderDegradeReason}`
                    : " Connect an embedding backend for semantic dispatch."}
                </span>
              )}
              {result.skippedServers.length > 0 && (
                <span className="text-amber-500"> Skipped: {result.skippedServers.map((s) => s.name).join(", ")}.</span>
              )}
            </span>
          ) : (
            <span>
              {enabledTools} tool{enabledTools === 1 ? "" : "s"} enabled.
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setExplainerOpen((open) => !open)}
            aria-expanded={explainerOpen}
            aria-label="About Compile Tools and smallchat"
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors",
              "hover:bg-muted hover:text-foreground",
              explainerOpen && "bg-muted text-foreground",
              compact ? "h-9 w-9" : "h-10 w-10"
            )}
          >
            <Info className={compact ? "h-4 w-4" : "h-5 w-5"} />
          </button>
          <button
            onClick={onUndo}
            disabled={!dirty || compiling}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-red-600/60 font-medium text-red-500 transition-colors",
              "hover:bg-red-600/10 disabled:pointer-events-none disabled:opacity-40",
              compact ? "h-9 px-3 text-xs" : "h-10 px-4 text-sm"
            )}
          >
            <Undo2 className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
            Undo Changes
          </button>
          <button
            onClick={onCompile}
            disabled={compiling || enabledTools === 0}
            className={cn(
              "inline-flex items-center gap-2 rounded-full bg-green-600 font-semibold text-white shadow-sm transition-colors",
              "hover:bg-green-500 disabled:pointer-events-none disabled:opacity-50",
              compact ? "h-9 px-4 text-xs" : "h-11 px-6 text-base"
            )}
          >
            <Hammer className={cn(compact ? "h-4 w-4" : "h-5 w-5", compiling && "animate-pulse")} />
            {compiling ? "Compiling…" : "Compile Tools"}
          </button>
        </div>
      </div>
    </div>
  );
}
