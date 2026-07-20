"use client";

import { useCallback, useState } from "react";
import { Wrench } from "lucide-react";
import { AddServerForm } from "@/components/tools/add-server-form";
import { CompileFooter, type CompileResult } from "@/components/tools/compile-footer";
import { RegistrySearch } from "@/components/tools/registry-search";
import { ServerBlade } from "@/components/tools/server-blade";
import { ServerInspector } from "@/components/tools/server-inspector";
import {
  cloneDrafts,
  draftsDiffer,
  toDraft,
  type AddCandidate,
  type RegistryEntry,
  type ServerDraft,
  type ServerRow,
  type ServerTool,
  type ToolkitSummary,
} from "@/components/tools/types";
import { Badge } from "@/components/ui/badge";

export function ToolsConsole({
  initialServers,
  initialToolkit,
  initialStale = false,
  suggested,
  compact = false,
  onCompiled,
}: {
  initialServers: ServerRow[];
  initialToolkit: ToolkitSummary | null;
  initialStale?: boolean;
  suggested: RegistryEntry[];
  compact?: boolean;
  onCompiled?: (result: CompileResult) => void;
}) {
  const [persisted, setPersisted] = useState<ServerDraft[]>(initialServers.map(toDraft));
  const [draft, setDraft] = useState<ServerDraft[]>(cloneDrafts(initialServers.map(toDraft)));
  const [toolkit, setToolkit] = useState<ToolkitSummary | null>(initialToolkit);
  const [stale, setStale] = useState(initialStale);
  const [compiling, setCompiling] = useState(false);
  const [result, setResult] = useState<CompileResult | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<AddCandidate | null>(null);
  const [deadUrls, setDeadUrls] = useState<Set<string>>(new Set());

  const markDead = useCallback((url: string) => {
    const key = url.replace(/\/$/, "");
    setDeadUrls((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  const dirty = draftsDiffer(draft, persisted);

  function addServer(row: ServerRow, message: string) {
    const d = toDraft(row);
    setPersisted((p) => [...p, d]);
    setDraft((p) => [...p, { ...d, disabledTools: [...d.disabledTools] }]);
    setNotice(message);
    setStale(true);
    setCandidate(null);
  }

  function reauthorized(server: ServerRow) {
    const fresh = toDraft(server);
    setPersisted((p) => p.map((s) => (s.id === fresh.id ? fresh : s)));
    setDraft((p) =>
      p.map((s) =>
        s.id === fresh.id
          ? { ...fresh, enabled: s.enabled, disabledTools: [...s.disabledTools] }
          : s
      )
    );
    setNotice(`Reconnected ${server.name}.`);
    setStale(true);
  }

  async function refreshServer(id: string) {
    const res = await fetch(`/api/mcp-servers/${id}/refresh`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error ?? "Refresh failed.");
      return;
    }
    const apply = (list: ServerDraft[]) =>
      list.map((s) =>
        s.id === id
          ? {
              ...s,
              tools: data.tools as ServerTool[],
              disabledTools: (data.disabled_tools as string[]) ?? s.disabledTools,
              introspectedAt: data.introspected_at as string,
            }
          : s
      );
    setPersisted(apply);
    setDraft(apply);
  }

  async function deleteServer(id: string) {
    const target = draft.find((s) => s.id === id);
    if (!target) return;
    if (!window.confirm(`Remove ${target.name}? Compiled toolkits keep working until you compile again.`)) return;
    const res = await fetch(`/api/mcp-servers/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setNotice(data.error ?? "Could not remove the server.");
      return;
    }
    setPersisted((p) => p.filter((s) => s.id !== id));
    setDraft((p) => p.filter((s) => s.id !== id));
  }

  async function compile() {
    setCompiling(true);
    setCompileError(null);
    setResult(null);
    setNotice(null);
    try {
      const res = await fetch("/api/toolkits/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          servers: draft.map((s) => ({ id: s.id, enabled: s.enabled, disabled_tools: s.disabledTools })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCompileError(data.message ?? data.error ?? "Compilation failed.");
        return;
      }
      const outcome = data as CompileResult & { embedder: unknown };
      setPersisted(cloneDrafts(draft));
      setResult(outcome);
      setStale(false);
      setToolkit({
        id: outcome.toolkitId,
        stats: outcome.stats,
        embedder_label: outcome.embedderLabel,
        compiled_at: new Date().toISOString(),
      });
      onCompiled?.(outcome);
    } catch {
      setCompileError("Network hiccup — the compile didn't run, try again.");
    } finally {
      setCompiling(false);
    }
  }

  function undo() {
    setDraft(cloneDrafts(persisted));
    setCompileError(null);
  }

  return (
    <div className="relative flex flex-col rounded-2xl border border-border">
      <div className={compact ? "flex flex-col gap-3 p-3" : "flex flex-col gap-4 p-4"}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Wrench className="h-3.5 w-3.5" />
          {toolkit ? (
            <>
              <span>
                Compiled {new Date(toolkit.compiled_at).toLocaleString()} — {toolkit.stats.toolCount} tools,{" "}
                {toolkit.stats.uniqueSelectorCount} selectors
              </span>
              <Badge variant="secondary" className="text-[10px]">
                {toolkit.embedder_label}
              </Badge>
              {stale && (
                <Badge variant="outline" className="border-destructive/50 text-[10px] text-destructive">
                  stale — recompile
                </Badge>
              )}
            </>
          ) : (
            <span>No toolkit compiled yet — add a server and hit Compile Tools.</span>
          )}
        </div>

        {notice && <p className="text-xs text-muted-foreground">{notice}</p>}

        {draft.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            No MCP servers connected yet — search the registry or add one by URL.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {draft.map((server) => (
              <ServerBlade
                key={server.id}
                server={server}
                compact={compact}
                onChange={(next) => setDraft((all) => all.map((s) => (s.id === next.id ? next : s)))}
                onRefresh={compact ? undefined : () => refreshServer(server.id)}
                onDelete={compact ? undefined : () => deleteServer(server.id)}
                onReauthorized={compact ? undefined : reauthorized}
              />
            ))}
          </div>
        )}

        {!compact && (
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card/30 p-4">
            <h3 className="text-sm font-semibold">Add servers</h3>
            <RegistrySearch
              suggested={suggested}
              existingUrls={new Set(draft.map((s) => s.url.replace(/\/$/, "")))}
              deadUrls={deadUrls}
              onInspect={setCandidate}
              onDead={markDead}
            />
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or add by URL
              <span className="h-px flex-1 bg-border" />
            </div>
            <AddServerForm onInspect={setCandidate} />
          </div>
        )}
      </div>

      {candidate && (
        <ServerInspector
          candidate={candidate}
          onCancel={() => setCandidate(null)}
          onAdded={addServer}
          onDead={markDead}
        />
      )}

      <CompileFooter
        draft={draft}
        persisted={persisted}
        dirty={dirty}
        compiling={compiling}
        result={result}
        error={compileError}
        compact={compact}
        onCompile={compile}
        onUndo={undo}
      />
    </div>
  );
}
