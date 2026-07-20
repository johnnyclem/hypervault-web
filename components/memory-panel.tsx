"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenCheck, Layers, Network, Plus, Wrench, X } from "lucide-react";
import { SaveToVault } from "@/components/chat/save-to-vault";
import { fromApiMessage, type ChatContextSettings, type MessageRow } from "@/components/chat/chat-surface";
import { ToolTurn, type ToolTurnData } from "@/components/chat/tool-turn";
import { TurnActions, type TurnFeedback } from "@/components/chat/turn-actions";
import { ToolsDrawer } from "@/components/tools/tools-drawer";
import { DigestReview, type DigestRunView } from "@/components/digest-review";
import { JsxImportButton } from "@/components/jsx-import-button";
import { MemoryHistory } from "@/components/memory-history";
import { VaultGraph } from "@/components/vault-graph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/ingest/files";
import { scoreRecall } from "@/lib/memory";

export type MemoryListItem = {
  id: string;
  title: string;
  summary: string;
  tags: string[] | null;
  source: string;
  created_at: string;
};

export type MemoryLinkRow = { id: string; a_id: string; b_id: string; kind: string };

export type MemoryArtifactLinkRow = { id: string; memory_id: string; artifact_id: string; kind: string };

export type ArtifactOption = { id: string; slug: string; title: string; type?: string };

export type ChatBackend = { id: string; name: string; default_model: string | null };

type RecallResult = MemoryListItem & { score: number };

type MemoryDetail = {
  memory: MemoryListItem & { content: string };
  related: { id: string; title: string; summary: string }[];
  artifacts?: { id: string; slug: string; title: string; type: string }[];
  provenance?: {
    commit_id: string;
    message: string;
    author_kind: "user" | "agent" | "system";
    author_key_prefix?: string;
    committed_at: string;
  };
  revision_count?: number;
};

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function errorFrom(data: Record<string, unknown> | null, res: Response, fallback: string): string {
  if (data && typeof data.error === "string") return data.error;
  if (res.status === 413) return `That upload is too large — the import limit is ${MAX_UPLOAD_LABEL}.`;
  return `${fallback} (HTTP ${res.status})`;
}

export function MemoryPanel({
  memories,
  links,
  branch = "main",
  artifacts = [],
  artifactLinks = [],
  backends = [],
  initialOpenId = null,
  chatContextSettings = { smartContext: true, deepMemory: true },
  stenographerConfigured = false,
  hasToolkit = false,
  initialMode = "search",
  digestEnabled = false,
  digestRuns = [],
}: {
  memories: MemoryListItem[];
  links: MemoryLinkRow[];
  branch?: string;
  artifacts?: ArtifactOption[];
  artifactLinks?: MemoryArtifactLinkRow[];
  backends?: ChatBackend[];
  initialOpenId?: string | null;
  chatContextSettings?: ChatContextSettings;
  stenographerConfigured?: boolean;
  hasToolkit?: boolean;
  initialMode?: "search" | "ask" | "graph" | "digest";
  digestEnabled?: boolean;
  digestRuns?: DigestRunView[];
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const branchQuery = branch === "main" ? "" : `?branch=${encodeURIComponent(branch)}`;
  const [mode, setMode] = useState<"search" | "ask" | "graph" | "digest">(initialMode);
  const [query, setQuery] = useState("");
  const [serverResults, setServerResults] = useState<RecallResult[] | null>(null);
  const [recallMode, setRecallMode] = useState<"lexical" | "hybrid" | null>(null);
  const [searching, setSearching] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MemoryDetail | null>(null);
  const [showForm, setShowForm] = useState(memories.length === 0);
  const [draft, setDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState<"file" | "url" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [forgettingId, setForgettingId] = useState<string | null>(null);
  const [digestingId, setDigestingId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMode("search");
        requestAnimationFrame(() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (mode !== "search" || q.length < 2) {
      setServerResults(null);
      setRecallMode(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q });
        if (branch !== "main") params.set("branch", branch);
        const res = await fetch(`/api/memories?${params}`, { signal: controller.signal });
        const data = await readJson(res);
        if (res.ok && data && Array.isArray(data.results)) {
          setServerResults(data.results as RecallResult[]);
          setRecallMode((data.recall_mode as "lexical" | "hybrid") ?? "lexical");
        }
        setSearching(false);
      } catch {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, branch, mode]);

  const graphLinks = useMemo(
    () => links.map((l) => ({ ...l, kind: l.kind === "manual" ? ("manual" as const) : ("auto" as const) })),
    [links],
  );
  const graphArtifactLinks = useMemo(
    () =>
      artifactLinks.map((l) => ({ ...l, kind: l.kind === "manual" ? ("manual" as const) : ("auto" as const) })),
    [artifactLinks],
  );
  const bridgedArtifacts = useMemo(() => {
    const linked = new Set(artifactLinks.map((l) => l.artifact_id));
    return artifacts.filter((a) => linked.has(a.id)).map((a) => ({ ...a, type: a.type ?? "artifact" }));
  }, [artifacts, artifactLinks]);

  const linkCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of links) {
      counts.set(l.a_id, (counts.get(l.a_id) ?? 0) + 1);
      counts.set(l.b_id, (counts.get(l.b_id) ?? 0) + 1);
    }
    return counts;
  }, [links]);

  const visible = useMemo(() => {
    const q = query.trim();
    if (!q) return memories;
    if (serverResults) return serverResults;
    return memories
      .map((m) => ({ m, score: scoreRecall(q, m) }))
      .filter((r) => r.score > 0)
      .sort((x, y) => y.score - x.score)
      .map((r) => r.m);
  }, [memories, query, serverResults]);

  async function loadDetail(id: string) {
    try {
      const res = await fetch(`/api/memories/${id}${branchQuery}`);
      const data = await readJson(res);
      if (res.ok && data) setDetail(data as unknown as MemoryDetail);
      else setError(errorFrom(data, res, "Couldn't load that memory."));
    } catch {
      setError("Network hiccup — try again.");
    }
  }

  async function openMemory(id: string) {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      setHistoryId(null);
      setEditing(false);
      return;
    }
    setOpenId(id);
    setDetail(null);
    setHistoryId(null);
    setEditing(false);
    await loadDetail(id);
  }

  useEffect(() => {
    if (!initialOpenId) return;
    setOpenId(initialOpenId);
    loadDetail(initialOpenId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenId]);

  async function saveEdit(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/memories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle, content: editContent, branch }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(errorFrom(data, res, "Couldn't save the edit."));
        return;
      }
      setEditing(false);
      setNotice((data?.message as string) ?? "Edited.");
      setOpenId(null);
      setDetail(null);
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function memorize() {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft, source: "chat", branch }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(errorFrom(data, res, "Couldn't memorize that right now."));
        return;
      }
      setDraft("");
      setNotice((data?.message as string) ?? "Memorized.");
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`"${file.name}" is over the ${MAX_UPLOAD_LABEL} import limit — split it or trim it down.`);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setImporting("file");
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/memories/import${branchQuery}`, { method: "POST", body: form });
      const data = await readJson(res);
      if (!res.ok) {
        setError(errorFrom(data, res, "Couldn't import that file."));
        return;
      }
      setNotice((data?.message as string) ?? "Imported.");
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setImporting(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function importUrl() {
    const url = urlDraft.trim();
    if (!url) return;
    setImporting("url");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/memories/import${branchQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(errorFrom(data, res, "Couldn't import that URL."));
        return;
      }
      setUrlDraft("");
      setNotice((data?.message as string) ?? "Imported.");
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setImporting(null);
    }
  }

  async function forget(id: string) {
    if (forgettingId !== id) {
      setForgettingId(id);
      return;
    }
    setForgettingId(null);
    setError(null);
    try {
      const res = await fetch(`/api/memories/${id}${branchQuery}`, { method: "DELETE" });
      const data = await readJson(res);
      if (!res.ok) {
        setError(errorFrom(data, res, "Couldn't forget that memory."));
        return;
      }
      if (openId === id) {
        setOpenId(null);
        setDetail(null);
      }
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    }
  }

  async function digest(id: string) {
    setDigestingId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/digest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryId: id, branch }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(errorFrom(data, res, "Couldn't digest that memory."));
        return;
      }
      if (data?.run_id) {
        setMode("digest");
        router.refresh();
      } else {
        setNotice(
          typeof data?.message === "string" ? data.message : "Nothing to split — this reads as a single memory."
        );
      }
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setDigestingId(null);
    }
  }

  function openFromGraph(id: string) {
    setMode("search");
    setOpenId(id);
    setDetail(null);
    setHistoryId(null);
    setEditing(false);
    loadDetail(id);
  }

  const modeTab = (value: "search" | "ask" | "graph" | "digest", label: string, badge?: number) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        mode === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
      aria-pressed={mode === value}
    >
      {label}
      {Boolean(badge) && (
        <Badge variant="accent" className="text-[10px]">
          {badge}
        </Badge>
      )}
    </button>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex shrink-0 flex-wrap items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5">
            {modeTab("search", "Search")}
            {modeTab("ask", "Ask")}
            {modeTab("graph", "Graph")}
            {modeTab("digest", "🍽️ Digest", digestRuns.length)}
          </div>
          <Button
            variant={showForm ? "outline" : "default"}
            onClick={() => {
              if (showForm) {
                setShowForm(false);
                return;
              }
              setMode("search");
              setShowForm(true);
            }}
            aria-expanded={showForm}
            className="shrink-0"
          >
            {showForm ? (
              <>
                <X className="h-4 w-4" />
                Close
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Memorize / import
              </>
            )}
          </Button>
        </div>

        {mode === "search" && (
          <div className="relative">
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Recall anything… e.g. "that fix for async retries"'
              className="h-12 pr-16 text-base"
              autoFocus
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              ⌘K
            </kbd>
          </div>
        )}
        {mode === "ask" && (
          <p className="text-sm text-muted-foreground">
            Chat with your wiki — answers are grounded in the memories recalled for each question.
          </p>
        )}
        {mode === "graph" && (
          <p className="text-sm text-muted-foreground">
            Your wiki as a semantic map — memories, their links, and the artifacts they bridge to.
          </p>
        )}
        {mode === "digest" && (
          <p className="text-sm text-muted-foreground">
            One memory that&rsquo;s really many — review the splits HyperVault proposes and apply the ones
            that fit.
          </p>
        )}
        {mode === "search" && (
          <p className="text-xs text-muted-foreground">
            {query.trim()
              ? `${visible.length} match${visible.length === 1 ? "" : "es"}${
                  searching
                    ? " · recalling…"
                    : serverResults
                      ? recallMode === "hybrid"
                        ? " · semantic + keyword recall"
                        : " · keyword recall"
                      : ""
                }`
              : `${memories.length} memor${memories.length === 1 ? "y" : "ies"} in your wiki`}
          </p>
        )}
      </div>

      {mode === "ask" && (
        <AskMemories
          backends={backends}
          contextSettings={chatContextSettings}
          stenographerConfigured={stenographerConfigured}
          hasToolkit={hasToolkit}
        />
      )}

      {mode === "graph" && (
        <VaultGraph
          artifacts={bridgedArtifacts}
          connections={[]}
          memories={memories}
          memoryLinks={graphLinks}
          memoryArtifactLinks={graphArtifactLinks}
          onMemoryClick={openFromGraph}
        />
      )}

      {mode === "digest" && <DigestReview initialEnabled={digestEnabled} runs={digestRuns} />}

      {mode === "search" && showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Memorize this</CardTitle>
            <CardDescription>
              Paste anything from a chat or coding session. It gets auto-titled, auto-tagged, summarized, and
              linked to related memories — no cleanup needed.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Drop the chunk worth keeping…"
              rows={6}
            />
            <div className="flex items-center gap-3">
              <Button onClick={memorize} disabled={busy || !draft.trim()}>
                {busy ? "Memorizing…" : "Memorize"}
              </Button>
              {notice && <p className="text-xs text-accent">{notice}</p>}
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Or import</p>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx,.md,.markdown,.mdx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importFile(f);
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  disabled={importing !== null}
                >
                  {importing === "file" ? "Importing file…" : "Import a file"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  PDF, DOCX, Markdown, or plain text · up to {MAX_UPLOAD_LABEL}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <JsxImportButton
                  label="Import .jsx artifact"
                  tags={["memory"]}
                  refreshOnSave
                  showResult={false}
                  onSaved={(result, fileName) =>
                    setNotice(`Imported ${fileName} as a vault artifact — ${result.url}`)
                  }
                  onError={setError}
                />
                <span className="text-xs text-muted-foreground">
                  A React component becomes a running, installable artifact — not wiki text.
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-2">
                  <Input
                    value={urlDraft}
                    onChange={(e) => setUrlDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        importUrl();
                      }
                    }}
                    placeholder="https://github.com/owner/repo — or any article URL"
                    disabled={importing !== null}
                  />
                  <Button
                    variant="outline"
                    onClick={importUrl}
                    disabled={importing !== null || !urlDraft.trim()}
                    className="shrink-0"
                  >
                    {importing === "url" ? "Importing…" : "Import URL"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  GitHub repos become a full project digest; any other page is scraped into a knowledgebase
                  entry in your wiki.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {mode === "search" && error && <p className="text-sm text-destructive">{error}</p>}

      <div className={mode === "search" ? "flex flex-col gap-3" : "hidden"}>
        {visible.length === 0 && (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {query.trim()
              ? searching
                ? "Recalling from your wiki…"
                : "Nothing matches yet — try fewer words, or memorize it now so future-you can recall it."
              : "Your wiki is empty. Memorize your first chunk above, or let your agents do it via MCP."}
          </p>
        )}
        {visible.map((m) => {
          const linkCount = linkCounts.get(m.id) ?? 0;
          const open = openId === m.id;
          return (
            <Card key={m.id} className={open ? "border-accent/50" : undefined}>
              <button type="button" className="w-full text-left" onClick={() => openMemory(m.id)}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base">{m.title}</CardTitle>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(m.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <CardDescription>{m.summary}</CardDescription>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                      {m.source}
                    </Badge>
                    {(m.tags ?? []).slice(0, 6).map((t) => (
                      <Badge key={t} variant="outline" className="text-[10px]">
                        {t}
                      </Badge>
                    ))}
                    {linkCount > 0 && (
                      <Badge variant="accent" className="text-[10px]">
                        {linkCount} link{linkCount === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
              </button>
              {open && (
                <CardContent className="flex flex-col gap-3 border-t border-border pt-4">
                  {!detail ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : editing ? (
                    <div className="flex flex-col gap-2">
                      <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Title" />
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={10}
                        className="font-mono text-xs"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveEdit(m.id)} disabled={busy || !editContent.trim()}>
                          {busy ? "Committing…" : "Commit edit"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-4 font-mono text-xs">
                        {detail.memory.content}
                      </pre>
                      {detail.provenance && (
                        <p className="text-xs text-muted-foreground">
                          Last commit{" "}
                          <span className="font-mono">{detail.provenance.commit_id.slice(0, 8)}</span>
                          {" · "}
                          {detail.provenance.message}
                          {" · by "}
                          {detail.provenance.author_kind === "agent"
                            ? `agent ${detail.provenance.author_key_prefix ?? ""}`.trim()
                            : detail.provenance.author_kind === "system"
                              ? "system"
                              : "you"}
                          {" · "}
                          {new Date(detail.provenance.committed_at).toLocaleString()}
                          {typeof detail.revision_count === "number" && detail.revision_count > 0
                            ? ` · ${detail.revision_count} revision${detail.revision_count === 1 ? "" : "s"}`
                            : ""}
                        </p>
                      )}
                      {detail.related.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Linked memories
                          </p>
                          <ul className="flex flex-col gap-1">
                            {detail.related.map((r) => (
                              <li key={r.id}>
                                <button
                                  type="button"
                                  className="text-left text-sm text-accent underline underline-offset-4"
                                  onClick={() => openMemory(r.id)}
                                >
                                  {r.title}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {(detail.artifacts ?? []).length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Linked artifacts
                          </p>
                          <ul className="flex flex-col gap-1">
                            {(detail.artifacts ?? []).map((a) => (
                              <li key={a.id}>
                                <a
                                  href={`/a/${a.slug}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-sm text-accent underline underline-offset-4"
                                >
                                  {a.title} ↗
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {historyId === m.id && <MemoryHistory memoryId={m.id} branch={branch} />}
                    </>
                  )}
                  {!editing && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (!detail) return;
                          setEditTitle(detail.memory.title);
                          setEditContent(detail.memory.content);
                          setEditing(true);
                        }}
                        disabled={!detail}
                      >
                        Edit
                      </Button>
                      {branch === "main" && (
                        <MemoryConnectControl
                          memory={m}
                          others={memories.filter((o) => o.id !== m.id)}
                          artifacts={artifacts}
                          onConnected={() => {
                            loadDetail(m.id);
                            router.refresh();
                          }}
                        />
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setHistoryId((h) => (h === m.id ? null : m.id))}
                      >
                        {historyId === m.id ? "Hide history" : "History"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => digest(m.id)}
                        disabled={digestingId === m.id}
                        title="Split this into discrete memories"
                      >
                        {digestingId === m.id ? "Digesting…" : "Digest"}
                      </Button>
                      <Button
                        variant={forgettingId === m.id ? "destructive" : "ghost"}
                        size="sm"
                        onClick={() => forget(m.id)}
                        onBlur={() => setForgettingId((f) => (f === m.id ? null : f))}
                      >
                        {forgettingId === m.id ? "Really forget?" : "Forget"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function MemoryConnectControl({
  memory,
  others,
  artifacts,
  onConnected,
}: {
  memory: MemoryListItem;
  others: MemoryListItem[];
  artifacts: ArtifactOption[];
  onConnected: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (others.length === 0 && artifacts.length === 0) return null;

  async function connect() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: memory.id, target }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(errorFrom(data, res, "Couldn't connect."));
        return;
      }
      setOpen(false);
      setTarget("");
      onConnected();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Connect
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className="h-8 max-w-[220px] rounded-lg border border-border bg-card px-2 text-xs text-foreground"
        aria-label={`Connect ${memory.title} to`}
      >
        <option value="">Connect to…</option>
        {others.length > 0 && (
          <optgroup label="Memories">
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </optgroup>
        )}
        {artifacts.length > 0 && (
          <optgroup label="Artifacts">
            {artifacts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <Button variant="secondary" size="sm" onClick={connect} disabled={busy || !target}>
        {busy ? "…" : "Link"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => (setOpen(false), setError(null))}>
        ✕
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

function AskMemories({
  backends,
  contextSettings,
  stenographerConfigured,
  hasToolkit: initialHasToolkit,
}: {
  backends: ChatBackend[];
  contextSettings: ChatContextSettings;
  stenographerConfigured: boolean;
  hasToolkit: boolean;
}) {
  const [backendId, setBackendId] = useState(backends[0]?.id ?? "");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [thread, setThread] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useRecall, setUseRecall] = useState(true);
  const [smartContext, setSmartContext] = useState(contextSettings.smartContext);
  const [deepMemory, setDeepMemory] = useState(contextSettings.deepMemory);
  const [hasToolkit, setHasToolkit] = useState(initialHasToolkit);
  const [useTools, setUseTools] = useState(true);
  const [showToolsDrawer, setShowToolsDrawer] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (thread.length > 0) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [thread]);

  function toggleContextSetting(key: "smart_context" | "deep_memory", next: boolean) {
    if (key === "smart_context") setSmartContext(next);
    else setDeepMemory(next);
    fetch("/api/chat-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: next }),
    }).catch(() => {});
  }

  if (backends.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ask your memories</CardTitle>
          <CardDescription>
            Type a question and get an answer grounded in your wiki — the relevant memories are
            recalled semantically and handed to the model as context. Connect an LLM backend first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a href="/chat" className="text-sm text-accent underline underline-offset-4">
            Connect a backend in Chat →
          </a>
        </CardContent>
      </Card>
    );
  }

  async function ask() {
    const message = draft.trim();
    if (!message || busy || !backendId) return;
    setBusy(true);
    setError(null);
    setThread((t) => [...t, { role: "user", content: message }]);
    setDraft("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backend_id: backendId,
          message,
          conversation_id: conversationId ?? undefined,
          use_recall: useRecall,
          use_smart_context: smartContext,
          use_deep_memory: deepMemory,
          use_tools: hasToolkit ? useTools : undefined,
        }),
      });
      const data = await readJson(res);
      if (!res.ok || !data) {
        setError(errorFrom(data, res, "The backend request failed."));
        return;
      }
      if (typeof data.conversation_id === "string") setConversationId(data.conversation_id);
      const toolTurnRows: MessageRow[] = Array.isArray((data.tools as { turns?: ToolTurnData[] })?.turns)
        ? ((data.tools as { turns: ToolTurnData[] }).turns).map((t) => ({
            role: "tool",
            content: "",
            toolTurn: t,
          }))
        : [];
      if ((data.tools as { status?: string })?.status === "stale") {
        const detail = (data.tools as { embedder?: { detail?: string } })?.embedder?.detail;
        setError(detail ?? "Your toolkit was compiled with a different embedding setup — recompile it under Tools.");
      }
      setThread((t) => [
        ...t,
        ...toolTurnRows,
        {
          ...fromApiMessage(data.reply as Parameters<typeof fromApiMessage>[0]),
          recalled: Array.isArray(data.recalled_memories) ? (data.recalled_memories as string[]) : undefined,
          deepMemory: Array.isArray(data.deep_memory) ? (data.deep_memory as string[]) : undefined,
        },
      ]);
    } catch {
      setError("Network hiccup — your question wasn't sent, try again.");
    } finally {
      setBusy(false);
    }
  }

  const TOGGLE_ON = "border-primary/60 bg-primary/15 text-foreground";
  const TOGGLE_OFF = "border-border text-muted-foreground hover:bg-muted";
  const toggleClass = (on: boolean) =>
    `inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
      on ? TOGGLE_ON : TOGGLE_OFF
    }`;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <ToolsDrawer
        open={showToolsDrawer}
        onClose={() => setShowToolsDrawer(false)}
        onCompiled={() => {
          setHasToolkit(true);
          setUseTools(true);
        }}
      />

      <div className="flex max-h-[50dvh] flex-col gap-3 overflow-y-auto">
        {thread.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Ask anything your wiki might know — &ldquo;what did I decide about auth?&rdquo;, &ldquo;summarize
            that paper I imported&rdquo;. Recall finds the memories by meaning, not just keywords.
          </p>
        )}
        {thread.map((t, i) =>
          t.toolTurn ? (
            <ToolTurn key={t.id ?? i} turn={t.toolTurn} />
          ) : (
            <div
              key={t.id ?? i}
              className={`max-w-[90%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm ${
                t.role === "user"
                  ? "self-end bg-primary text-primary-foreground"
                  : "self-start border border-border bg-muted/50"
              }`}
            >
              {t.content}
              {t.role === "assistant" && t.truncated && (
                <div className="mt-2 text-[10px] text-destructive" role="note">
                  ⚠ The backend stopped at its length limit — the end of this reply is missing. Say
                  “continue” to get the rest.
                </div>
              )}
              {t.role === "assistant" && t.recalled && t.recalled.length > 0 && (
                <div className="mt-2 text-[10px] text-muted-foreground">
                  Grounded in your memories: {t.recalled.join(" · ")}
                </div>
              )}
              {t.role === "assistant" && t.deepMemory && t.deepMemory.length > 0 && (
                <div className="mt-2 text-[10px] text-muted-foreground">
                  From your conversation graph: {t.deepMemory.join(" · ")}
                </div>
              )}
              {t.role === "assistant" && t.model && (
                <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t.model}
                </div>
              )}
              {t.role === "assistant" && (
                <SaveToVault
                  content={t.content}
                  sourcePrompt={thread[i - 1]?.role === "user" ? thread[i - 1].content : undefined}
                  tag="memories"
                />
              )}
              {t.role === "assistant" && t.content.trim() && (
                <TurnActions
                  messageId={t.id || undefined}
                  content={t.content}
                  sourcePrompt={thread[i - 1]?.role === "user" ? thread[i - 1].content : undefined}
                  feedback={t.feedback ?? null}
                  onFeedbackChange={(next: TurnFeedback) =>
                    setThread((all) => all.map((row, j) => (j === i ? { ...row, feedback: next } : row)))
                  }
                />
              )}
            </div>
          ),
        )}
        {busy && <div className="self-start text-sm text-muted-foreground">Recalling &amp; thinking…</div>}
        <div ref={endRef} />
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {backends.length > 1 && (
            <select
              value={backendId}
              onChange={(e) => setBackendId(e.target.value)}
              className="h-8 max-w-56 rounded-lg border border-border bg-card px-2 text-xs text-foreground"
              aria-label="Backend"
            >
              {backends.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.default_model ? ` — ${b.default_model}` : ""}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setUseRecall((v) => !v)}
            aria-pressed={useRecall}
            title="Ground answers in the memories recalled from your wiki"
            className={toggleClass(useRecall)}
          >
            <BookOpenCheck className="h-3.5 w-3.5" />
            Wiki recall {useRecall ? "on" : "off"}
          </button>
          <button
            type="button"
            onClick={() => toggleContextSetting("smart_context", !smartContext)}
            aria-pressed={smartContext}
            title="Compress older turns of long chats so the model remembers more with fewer tokens"
            className={toggleClass(smartContext)}
          >
            <Layers className="h-3.5 w-3.5" />
            Smart context {smartContext ? "on" : "off"}
          </button>
          {stenographerConfigured && (
            <button
              type="button"
              onClick={() => toggleContextSetting("deep_memory", !deepMemory)}
              aria-pressed={deepMemory}
              title="Recall decisions, people, and topics from across all your conversations"
              className={toggleClass(deepMemory)}
            >
              <Network className="h-3.5 w-3.5" />
              Deep memory {deepMemory ? "on" : "off"}
            </button>
          )}
          {hasToolkit && (
            <button
              type="button"
              onClick={() => setUseTools((v) => !v)}
              aria-pressed={useTools}
              title="Dispatch intents to your compiled MCP tools semantically"
              className={toggleClass(useTools)}
            >
              <Wrench className="h-3.5 w-3.5" />
              Tools {useTools ? "on" : "off"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowToolsDrawer(true)}
            title="Configure MCP servers and compile tools"
            aria-label="Open tools"
            className={toggleClass(false)}
          >
            <Wrench className="h-3.5 w-3.5" />
            {hasToolkit ? "Manage" : "Add tools"}
          </button>
        </div>
        <div className="flex gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
            placeholder="Ask your memories anything…"
            rows={1}
            className="min-h-[44px] flex-1 resize-none"
            autoFocus
          />
          <Button onClick={ask} disabled={busy || !draft.trim()}>
            Ask
          </Button>
        </div>
      </div>
    </div>
  );
}
