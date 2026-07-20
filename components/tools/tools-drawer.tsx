"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import type { CompileResult } from "@/components/tools/compile-footer";
import { ToolsConsole } from "@/components/tools/tools-console";
import type { RegistryEntry, ServerRow, ToolkitSummary } from "@/components/tools/types";
import { Drawer } from "@/components/ui/drawer";

export function ToolsDrawer({
  open,
  onClose,
  onCompiled,
}: {
  open: boolean;
  onClose: () => void;
  onCompiled?: (result: CompileResult) => void;
}) {
  const [loaded, setLoaded] = useState<null | {
    servers: ServerRow[];
    toolkit: ToolkitSummary | null;
    stale: boolean;
  }>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoaded(null);
    setError(null);
    (async () => {
      try {
        const [serversRes, toolkitRes] = await Promise.all([fetch("/api/mcp-servers"), fetch("/api/toolkits")]);
        const serversData = await serversRes.json();
        const toolkitData = await toolkitRes.json();
        if (!serversRes.ok) {
          setError(serversData.error ?? "Could not load your MCP servers.");
          return;
        }
        setLoaded({
          servers: (serversData.servers as ServerRow[]) ?? [],
          toolkit: toolkitRes.ok ? ((toolkitData.toolkit as ToolkitSummary | null) ?? null) : null,
          stale: Boolean(toolkitData?.stale),
        });
      } catch {
        setError("Network hiccup — could not load your tools.");
      }
    })();
  }, [open]);

  const suggested: RegistryEntry[] = [];

  return (
    <Drawer open={open} onClose={onClose} side="right" title="Tools">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {!loaded && !error && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading tools…
          </div>
        )}
        {loaded && (
          <ToolsConsole
            initialServers={loaded.servers}
            initialToolkit={loaded.toolkit}
            initialStale={loaded.stale}
            suggested={suggested}
            compact
            onCompiled={onCompiled}
          />
        )}
        <Link
          href="/tools"
          className="inline-flex items-center gap-1 text-xs text-accent underline-offset-4 hover:underline"
        >
          Manage tools <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </Drawer>
  );
}
