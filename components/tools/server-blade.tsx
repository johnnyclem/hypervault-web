"use client";

import { useState } from "react";
import { ChevronDown, KeyRound, RefreshCw, Trash2, Vault } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { connectWithOAuth } from "@/components/tools/oauth-connect";
import type { ServerDraft, ServerRow, ServerTool } from "@/components/tools/types";
import { cn } from "@/lib/utils";

export function ServerBlade({
  server,
  compact = false,
  onChange,
  onRefresh,
  onDelete,
  onReauthorized,
}: {
  server: ServerDraft;
  compact?: boolean;
  onChange: (next: ServerDraft) => void;
  onRefresh?: () => Promise<void>;
  onDelete?: () => void;
  onReauthorized?: (server: ServerRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const disabled = new Set(server.disabledTools);
  const enabledCount = server.tools.filter((t) => !disabled.has(t.name)).length;

  async function reconnect() {
    if (reconnecting) return;
    setReconnecting(true);
    setReconnectError(null);
    const result = await connectWithOAuth({ url: server.url, name: server.name, serverId: server.id });
    setReconnecting(false);
    if (result.ok) {
      onReauthorized?.(result.server);
    } else if (!("cancelled" in result)) {
      setReconnectError(result.error);
    }
  }

  function toggleTool(tool: ServerTool) {
    const next = new Set(disabled);
    if (next.has(tool.name)) next.delete(tool.name);
    else next.add(tool.name);
    onChange({ ...server, disabledTools: [...next].sort() });
  }

  function setAll(enabled: boolean) {
    onChange({ ...server, disabledTools: enabled ? [] : server.tools.map((t) => t.name).sort() });
  }

  return (
    <div className="rounded-2xl border border-border bg-card/50">
      <div className={cn("flex items-center gap-2", compact ? "px-3 py-2" : "px-4 py-3")}>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !expanded && "-rotate-90")}
          />
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <span className="truncate">{server.name}</span>
              {server.secretBacked ? (
                <Vault className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Auth stored in AgentVault" />
              ) : (
                server.hasAuth && <KeyRound className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
            </span>
            {!compact && <span className="truncate text-xs text-muted-foreground">{server.url}</span>}
          </span>
        </button>
        <Badge variant="secondary" className="shrink-0">
          {server.enabled ? `${enabledCount}/${server.tools.length}` : "off"}
        </Badge>
        {onReauthorized && server.authType === "oauth" && !compact && (
          <button
            onClick={reconnect}
            disabled={reconnecting}
            title="Re-run the OAuth login for this server"
            aria-label={`Reconnect ${server.name}`}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <KeyRound className={cn("h-3.5 w-3.5", reconnecting && "animate-pulse")} />
          </button>
        )}
        {onRefresh && !compact && (
          <button
            onClick={async () => {
              setRefreshing(true);
              try {
                await onRefresh();
              } finally {
                setRefreshing(false);
              }
            }}
            title="Re-read the server's tool list"
            aria-label={`Refresh ${server.name}`}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </button>
        )}
        {onDelete && !compact && (
          <button
            onClick={onDelete}
            title="Remove this server"
            aria-label={`Remove ${server.name}`}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <ToggleSwitch
          on={server.enabled}
          label={`${server.name} enabled`}
          onToggle={() => onChange({ ...server, enabled: !server.enabled })}
        />
      </div>

      {reconnectError && (
        <p className={cn("text-xs text-destructive", compact ? "px-3 pb-2" : "px-4 pb-3")} role="alert">
          {reconnectError}
        </p>
      )}

      {expanded && (
        <div className={cn("border-t border-border", compact ? "px-3 py-2" : "px-4 py-3")}>
          {server.tools.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tools discovered — try a refresh.</p>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-3 text-xs">
                <button
                  onClick={() => setAll(true)}
                  disabled={!server.enabled}
                  className="text-accent underline-offset-4 hover:underline disabled:opacity-50"
                >
                  enable all
                </button>
                <button
                  onClick={() => setAll(false)}
                  disabled={!server.enabled}
                  className="text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
                >
                  disable all
                </button>
                <span className="ml-auto text-muted-foreground">Changes apply when you compile.</span>
              </div>
              <div className={cn("flex flex-col", server.enabled ? "" : "pointer-events-none opacity-50")}>
                {server.tools.map((tool) => {
                  const on = !disabled.has(tool.name);
                  return (
                    <div
                      key={tool.name}
                      className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className={cn("font-mono text-xs", !on && "text-muted-foreground line-through")}>
                          {tool.name}
                        </span>
                        {!compact && tool.description && (
                          <span className="line-clamp-1 text-[11px] text-muted-foreground">{tool.description}</span>
                        )}
                      </span>
                      <ToggleSwitch
                        on={on && server.enabled}
                        small
                        label={`${tool.name} enabled`}
                        onToggle={() => toggleTool(tool)}
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ToggleSwitch({
  on,
  onToggle,
  label,
  small = false,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  small?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "relative shrink-0 rounded-full border transition-colors",
        small ? "h-4 w-7" : "h-5 w-9",
        on ? "border-primary/60 bg-primary/40" : "border-border bg-muted"
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 -translate-y-1/2 rounded-full bg-foreground transition-all",
          small ? "h-2.5 w-2.5" : "h-3.5 w-3.5",
          on ? (small ? "left-3.5" : "left-[18px]") : "left-0.5"
        )}
      />
    </button>
  );
}
