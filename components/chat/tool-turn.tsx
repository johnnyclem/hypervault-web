"use client";

import { useState } from "react";
import { ChevronDown, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ToolTurnData = {
  intent: string;
  tool: string | null;
  ok: boolean;
  confidence?: number;
  tier?: string;
  preview?: string;
  error?: string;
  refinement?: { question: string; options: Array<{ label: string; intent: string; canonical?: string }> };
};

export function ToolTurn({ turn }: { turn: ToolTurnData }) {
  const [expanded, setExpanded] = useState(false);
  const detail = turn.error ?? turn.preview ?? "";

  return (
    <div className="self-start w-full max-w-[85%] rounded-xl border border-dashed border-border bg-muted/30 text-xs">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={expanded}
      >
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          <span className="text-muted-foreground">“{turn.intent}”</span>
          {turn.tool && (
            <>
              {" → "}
              <span className="font-mono">{turn.tool}</span>
            </>
          )}
        </span>
        {turn.tier && (
          <Badge
            variant={turn.ok ? "secondary" : "outline"}
            className={cn("shrink-0 text-[10px] uppercase", !turn.ok && "border-destructive/50 text-destructive")}
          >
            {turn.tier}
            {typeof turn.confidence === "number" ? ` ${Math.round(turn.confidence * 100)}%` : ""}
          </Badge>
        )}
        {!turn.ok && !turn.tier && (
          <Badge variant="outline" className="shrink-0 border-destructive/50 text-[10px] text-destructive">
            failed
          </Badge>
        )}
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", !expanded && "-rotate-90")}
        />
      </button>
      {expanded && (
        <div className="border-t border-dashed border-border px-3 py-2">
          {turn.refinement ? (
            <div className="flex flex-col gap-1">
              <p>{turn.refinement.question}</p>
              <ul className="list-disc pl-4 text-muted-foreground">
                {turn.refinement.options.map((o) => (
                  <li key={o.intent}>{o.label}</li>
                ))}
              </ul>
            </div>
          ) : detail ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
              {detail}
            </pre>
          ) : (
            <p className="text-muted-foreground">No output.</p>
          )}
        </div>
      )}
    </div>
  );
}
