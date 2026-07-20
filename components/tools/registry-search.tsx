"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Globe, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { AddCandidate, RegistryEntry } from "@/components/tools/types";

const normUrl = (u: string) => u.replace(/\/$/, "");

export function RegistrySearch({
  suggested,
  existingUrls,
  deadUrls,
  onInspect,
  onDead,
}: {
  suggested: RegistryEntry[];
  existingUrls: Set<string>;
  deadUrls?: Set<string>;
  onInspect: (candidate: AddCandidate) => void;
  onDead?: (url: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegistryEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [probed, setProbed] = useState<Record<string, boolean>>({});
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setFailed(false);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/registry/search?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        const servers = Array.isArray(data.servers) ? (data.servers as RegistryEntry[]) : [];
        setResults(servers);
        setFailed(res.ok && servers.length === 0 && query.trim().length > 2);
      } catch {
        setResults([]);
        setFailed(true);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  useEffect(() => {
    if (results.length === 0) return;
    const urls = results.map((r) => r.url);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/registry/liveness", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls }),
        });
        const data = await res.json();
        if (cancelled || !Array.isArray(data.results)) return;
        const verdicts: Record<string, boolean> = {};
        for (const r of data.results as { url: string; state: string }[]) {
          if (r.state === "dead") {
            verdicts[normUrl(r.url)] = true;
            onDead?.(r.url);
          } else if (r.state === "alive") {
            verdicts[normUrl(r.url)] = false;
          }
        }
        setProbed((prev) => ({ ...prev, ...verdicts }));
      } catch {
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [results, onDead]);

  function inspect(entry: RegistryEntry) {
    onInspect({
      url: entry.url,
      name: entry.name,
      registryId: entry.registryId,
      transport: entry.transport,
    });
  }

  const shown = useMemo(() => {
    const base = query.trim() ? results : suggested;
    const isDead = (entry: RegistryEntry) => {
      const key = normUrl(entry.url);
      if (key in probed) return probed[key];
      return Boolean(entry.dead) || Boolean(deadUrls?.has(key));
    };
    return base
      .map((entry) => ({ entry, dead: isDead(entry) }))
      .sort((a, b) => Number(a.dead) - Number(b.dead));
  }, [query, results, suggested, probed, deadUrls]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the MCP registry (remote servers only)…"
          className="pl-9"
          aria-label="Search MCP registry"
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      {failed && !searching && (
        <p className="text-xs text-muted-foreground">
          Nothing remote-capable matched — the registry may be unavailable. Add the server by URL below.
        </p>
      )}
      {shown.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {shown.map(({ entry, dead }) => {
            const already = existingUrls.has(normUrl(entry.url));
            return (
              <div
                key={`${entry.registryId}:${entry.url}`}
                className="flex items-start gap-3 rounded-xl border border-border px-3 py-3"
              >
                <Globe className={`mt-0.5 h-4 w-4 shrink-0 ${dead ? "text-destructive/70" : "text-muted-foreground"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`text-sm font-medium break-words ${dead ? "text-muted-foreground" : ""}`}>
                      {entry.name}
                    </span>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {entry.transport}
                    </Badge>
                    {dead && (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-destructive/50 text-[10px] text-destructive"
                        title="This endpoint returned HTTP 404/410 — it may be undeployed or moved."
                      >
                        unreachable
                      </Badge>
                    )}
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{entry.description || entry.url}</p>
                </div>
                <button
                  onClick={() => inspect(entry)}
                  disabled={already}
                  className="mt-0.5 inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-border px-3 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {already ? (
                    "Added"
                  ) : (
                    <>
                      <Search className="h-3 w-3" /> Inspect
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
