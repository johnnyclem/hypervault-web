"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BookOpenCheck, Check, ChevronDown, GitBranch, History, Layers, Link2, Network, Plus, Settings2, Upload, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SaveToVault } from "@/components/chat/save-to-vault";
import { ToolTurn, type ToolTurnData } from "@/components/chat/tool-turn";
import { TurnActions, type TurnFeedback } from "@/components/chat/turn-actions";
import { ToolsDrawer } from "@/components/tools/tools-drawer";
import { JsxImportButton, type JsxImportResult } from "@/components/jsx-import-button";
import { stripThinking } from "@/lib/chat/thinking";
import { isCustomProvider, PROVIDERS, type ProviderId } from "@/lib/backends/providers";
import { parseIntentCall, parseToolResultBlock } from "@/lib/smallchat/intent";

export type ConversationRow = {
  id: string;
  title: string;
  source_platform: string;
  model: string | null;
  updated_at: string;
  visibility?: "private" | "shared" | "public";
  share_slug?: string | null;
};

export type BackendRow = {
  id: string;
  name: string;
  provider: string;
  base_url: string | null;
  default_model: string | null;
  embedding_model: string | null;
  key_hint: string | null;
};

export type MessageRow = {
  id?: string;
  role: string;
  content: string;
  model?: string | null;
  recalled?: string[];
  deepMemory?: string[];
  feedback?: TurnFeedback;
  toolTurn?: ToolTurnData;
  toolSelection?: ToolSelection;
  truncated?: boolean;
};

export type ToolSelection = {
  intent: string;
  question: string;
  options: Array<{ label: string; canonical: string; args: Record<string, unknown> }>;
};

export type ChatContextSettings = {
  smartContext: boolean;
  deepMemory: boolean;
};

type RecallBranch = {
  name: string;
  is_default: boolean;
  memory_count: number;
};

const MAIN_BRANCH = "main";

export function fromApiMessage(
  m: Omit<MessageRow, "feedback"> & { feedback?: number | TurnFeedback | null }
): MessageRow {
  let content = m.content;
  if (m.role === "assistant") {
    const { text, reasoning } = stripThinking(m.content);
    content = text || reasoning;
  }
  return {
    ...m,
    content,
    feedback: m.feedback === 1 || m.feedback === "up" ? "up" : m.feedback === -1 || m.feedback === "down" ? "down" : null,
  };
}

function hydrateHistoryRow(m: MessageRow): MessageRow | null {
  if (m.role === "tool") {
    const parsed = parseToolResultBlock(m.content);
    if (!parsed) return null;
    return {
      ...m,
      content: "",
      toolTurn: {
        intent: parsed.intent,
        tool: parsed.tool,
        ok: parsed.ok,
        confidence: parsed.confidence,
        tier: parsed.tier,
        preview:
          typeof parsed.content === "string"
            ? parsed.content.slice(0, 2000)
            : parsed.content !== undefined
              ? JSON.stringify(parsed.content).slice(0, 2000)
              : undefined,
        error: parsed.error,
        refinement: parsed.refinement,
      },
    };
  }
  if (m.role === "assistant") {
    const call = parseIntentCall(m.content);
    if (call) {
      if (!call.visibleText) return null;
      return { ...m, content: call.visibleText };
    }
  }
  return m;
}

const PLATFORM_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  grok: "Grok",
  hypervault: "HyperVault",
  other: "Imported",
};

export function ChatSurface({
  initialConversations,
  initialBackends,
  initialContextSettings = { smartContext: true, deepMemory: true },
  stenographerConfigured = false,
  initialHasToolkit = false,
}: {
  initialConversations: ConversationRow[];
  initialBackends: BackendRow[];
  initialContextSettings?: ChatContextSettings;
  stenographerConfigured?: boolean;
  initialHasToolkit?: boolean;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [backends, setBackends] = useState(initialBackends);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [backendId, setBackendId] = useState(initialBackends[0]?.id ?? "");
  const [useRecall, setUseRecall] = useState(true);
  const [branches, setBranches] = useState<RecallBranch[]>([]);
  const [recallBranch, setRecallBranch] = useState(MAIN_BRANCH);
  const [smartContext, setSmartContext] = useState(initialContextSettings.smartContext);
  const [deepMemory, setDeepMemory] = useState(initialContextSettings.deepMemory);
  const [hasToolkit, setHasToolkit] = useState(initialHasToolkit);
  const [useTools, setUseTools] = useState(true);
  const [showToolsDrawer, setShowToolsDrawer] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolNotice, setToolNotice] = useState<string | null>(null);
  const [showBackendForm, setShowBackendForm] = useState(initialBackends.length === 0);
  const [showHistory, setShowHistory] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [jsxImportNotice, setJsxImportNotice] = useState<string | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mind/branches")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !Array.isArray(data?.branches)) return;
        const rows = (data.branches as RecallBranch[]).map((b) => ({
          name: b.name,
          is_default: b.is_default,
          memory_count: b.memory_count,
        }));
        setBranches(rows);
        setRecallBranch((cur) => (rows.some((b) => b.name === cur) ? cur : MAIN_BRANCH));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function openConversation(id: string) {
    setActiveId(id);
    setShowHistory(false);
    setMessages([]);
    setError(null);
    const res = await fetch(`/api/conversations/${id}`);
    const data = await res.json();
    if (res.ok) {
      setMessages(
        (data.messages as MessageRow[])
          .map(fromApiMessage)
          .map(hydrateHistoryRow)
          .filter((m): m is MessageRow => m !== null)
      );
    } else setError(data.error ?? "Could not load that conversation.");
  }

  function newConversation() {
    setActiveId(null);
    setShowHistory(false);
    setMessages([]);
    setError(null);
  }

  function toggleContextSetting(key: "smart_context" | "deep_memory", next: boolean) {
    if (key === "smart_context") setSmartContext(next);
    else setDeepMemory(next);
    fetch("/api/chat-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: next }),
    }).catch(() => {});
  }

  function send() {
    return runTurn({ message: draft.trim() });
  }

  function chooseTool(option: { label: string; canonical: string; args: Record<string, unknown> }) {
    return runTurn({
      message: `Use “${option.label}”.`,
      toolChoice: { canonical: option.canonical, args: option.args },
    });
  }

  async function runTurn(opts: {
    message: string;
    toolChoice?: { canonical: string; args: Record<string, unknown> };
  }) {
    const message = opts.message.trim();
    if (!message || !backendId || busy) return;
    setBusy(true);
    setError(null);
    setMessages((m) => [...m, { role: "user", content: message }]);
    setDraft("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backend_id: backendId,
          message,
          conversation_id: activeId ?? undefined,
          use_recall: useRecall,
          recall_branch: useRecall ? recallBranch : undefined,
          use_smart_context: smartContext,
          use_deep_memory: deepMemory,
          use_tools: hasToolkit ? useTools : undefined,
          tool_choice: opts.toolChoice,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "The backend request failed.");
        return;
      }
      const toolTurnRows: MessageRow[] = Array.isArray(data.tools?.turns)
        ? (data.tools.turns as ToolTurnData[]).map((t) => ({ role: "tool", content: "", toolTurn: t }))
        : [];
      const toolEmbedder = data.tools?.embedder as
        | { lexical?: boolean; label?: string; upgrade_available?: boolean; detail?: string; onnx_error?: string | null }
        | null
        | undefined;
      setToolNotice(null);
      if (data.tools?.status === "stale") {
        setError(
          toolEmbedder?.detail ??
            "Your toolkit was compiled with a different embedding setup — recompile it under Tools."
        );
      } else if (toolEmbedder?.lexical) {
        setToolNotice(
          `Tools are matching lexically (${toolEmbedder.label}) — clear requests can fall to the tool picker. ` +
            (toolEmbedder.onnx_error
              ? `The semantic model didn't load: ${toolEmbedder.onnx_error}. `
              : "Connect an embedding backend or recompile with the local model. ") +
            "Recompile under Tools."
        );
      }
      const selection: ToolSelection | undefined =
        data.tool_selection && Array.isArray(data.tool_selection.options) && data.tool_selection.options.length > 0
          ? (data.tool_selection as ToolSelection)
          : undefined;
      setMessages((m) => [
        ...m,
        ...toolTurnRows,
        {
          ...fromApiMessage(data.reply),
          recalled: Array.isArray(data.recalled_memories) ? data.recalled_memories : undefined,
          deepMemory: Array.isArray(data.deep_memory) ? data.deep_memory : undefined,
          toolSelection: selection,
        },
      ]);
      if (!activeId) {
        setActiveId(data.conversation_id);
        setConversations((c) => [
          {
            id: data.conversation_id,
            title: message.slice(0, 80),
            source_platform: "hypervault",
            model: data.reply.model,
            updated_at: new Date().toISOString(),
            visibility: "private",
            share_slug: null,
          },
          ...c,
        ]);
      }
    } catch {
      setError("Network hiccup — your message wasn't sent, try again.");
    } finally {
      setBusy(false);
    }
  }

  async function changeVisibility(next: "private" | "shared" | "public") {
    if (!activeId) return;
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not change who can see this chat.");
        return;
      }
      setConversations((all) =>
        all.map((c) =>
          c.id === activeId
            ? { ...c, visibility: data.conversation.visibility, share_slug: data.conversation.share_slug }
            : c
        )
      );
    } catch {
      setError("Network hiccup — the visibility wasn't changed, try again.");
    }
  }

  function handleJsxImported(result: JsxImportResult, fileName: string) {
    setJsxImportNotice(`Imported ${fileName} as an artifact — ${result.url}`);
  }

  const activeBackend = backends.find((b) => b.id === backendId);
  const activeConversation = conversations.find((c) => c.id === activeId);

  const conversationList = (
    <>
      <div className="flex gap-2">
        <Button size="sm" className="flex-1 gap-1.5" onClick={newConversation}>
          <Plus className="h-4 w-4" />
          New chat
        </Button>
        <Link href="/vault/import">
          <Button size="sm" variant="outline" className="gap-1.5">
            <Upload className="h-4 w-4" />
            Import
          </Button>
        </Link>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {conversations.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">
            No conversations yet.{" "}
            <Link href="/vault/import" className="text-accent underline underline-offset-4">
              Import your history
            </Link>{" "}
            from ChatGPT, Claude, Gemini, or Grok — or just start typing.
          </p>
        )}
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => openConversation(c.id)}
            className={`flex flex-col gap-1 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
              c.id === activeId ? "bg-muted" : ""
            }`}
          >
            <span className="line-clamp-1">{c.title}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {PLATFORM_LABEL[c.source_platform] ?? c.source_platform}
            </span>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className="flex flex-1 flex-col gap-3 md:flex-row md:gap-4">
      <aside className="hidden md:flex md:w-72 md:shrink-0 md:flex-col md:gap-3">
        {conversationList}
      </aside>

      <Drawer
        open={showHistory}
        onClose={() => setShowHistory(false)}
        side="left"
        title="Conversations"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3">{conversationList}</div>
      </Drawer>

      <ToolsDrawer
        open={showToolsDrawer}
        onClose={() => setShowToolsDrawer(false)}
        onCompiled={() => {
          setHasToolkit(true);
          setUseTools(true);
        }}
      />

      <div className="flex items-center gap-2 md:hidden">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowHistory(true)}
          className="h-10 min-w-0 flex-1 justify-start gap-2 px-3"
        >
          <History className="h-4 w-4 shrink-0" />
          <span className="truncate font-normal">
            {activeConversation?.title ?? "Conversations"}
          </span>
          <Badge variant="secondary" className="ml-auto shrink-0">
            {conversations.length}
          </Badge>
        </Button>
        <Button size="sm" onClick={newConversation} className="h-10 gap-1.5 px-3">
          <Plus className="h-4 w-4" />
          New
        </Button>
      </div>

      <section className="flex min-h-[60dvh] flex-1 flex-col rounded-xl border">
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="m-auto max-w-md text-center text-sm text-muted-foreground">
              <p className="font-semibold text-foreground">Your whole AI life, one surface.</p>
              <p className="mt-2">
                Pick a backend below and start chatting — or open an imported conversation and
                continue it on a completely different model. Your vault is the memory; the model is
                just the engine.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            m.toolTurn ? (
              <ToolTurn key={m.id ?? i} turn={m.toolTurn} />
            ) : (
            <div
              key={m.id ?? i}
              className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm ${
                m.role === "user"
                  ? "self-end bg-primary text-primary-foreground"
                  : "self-start border bg-muted/50"
              }`}
            >
              {m.content}
              {m.role === "assistant" && m.truncated && (
                <div className="mt-2 text-[10px] text-destructive" role="note">
                  ⚠ The backend stopped at its length limit — the end of this reply is missing.
                  Say “continue” to get the rest.
                </div>
              )}
              {m.role === "assistant" && m.toolSelection && m.toolSelection.options.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5">
                  {m.toolSelection.options.map((o) => (
                    <button
                      key={o.canonical}
                      disabled={busy}
                      onClick={() => chooseTool(o)}
                      className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {m.role === "assistant" && m.recalled && m.recalled.length > 0 && (
                <div className="mt-2 text-[10px] text-muted-foreground">
                  Grounded in your memories: {m.recalled.join(" · ")}
                </div>
              )}
              {m.role === "assistant" && m.deepMemory && m.deepMemory.length > 0 && (
                <div className="mt-2 text-[10px] text-muted-foreground">
                  From your conversation graph: {m.deepMemory.join(" · ")}
                </div>
              )}
              {m.role === "assistant" && m.model && (
                <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {m.model}
                </div>
              )}
              {m.role === "assistant" && (
                <SaveToVault
                  content={m.content}
                  sourcePrompt={messages[i - 1]?.role === "user" ? messages[i - 1].content : undefined}
                />
              )}
              {m.role === "assistant" && m.content.trim() && (
                <TurnActions
                  messageId={m.id || undefined}
                  content={m.content}
                  sourcePrompt={messages[i - 1]?.role === "user" ? messages[i - 1].content : undefined}
                  feedback={m.feedback ?? null}
                  onFeedbackChange={(next) =>
                    setMessages((all) =>
                      all.map((row, j) => (j === i ? { ...row, feedback: next } : row))
                    )
                  }
                />
              )}
            </div>
            )
          ))}
          {busy && <div className="self-start text-sm text-muted-foreground">Thinking…</div>}
          <div ref={threadEnd} />
        </div>

        <div className="flex flex-col gap-2 border-t p-3">
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {toolNotice && !error && (
            <p className="text-xs text-amber-500" role="status">
              {toolNotice}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <select
              value={backendId}
              onChange={(e) => setBackendId(e.target.value)}
              className="h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm sm:h-9 sm:w-auto sm:max-w-72 sm:bg-transparent"
              aria-label="Backend"
            >
              {backends.length === 0 && <option value="">No backends connected</option>}
              {backends.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.default_model ? ` — ${b.default_model}` : ""}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center gap-2">
              <WikiRecallControl
                useRecall={useRecall}
                recallBranch={recallBranch}
                branches={branches}
                onToggle={() => setUseRecall((v) => !v)}
                onSelect={(branch) => {
                  if (branch === null) {
                    setUseRecall(false);
                  } else {
                    setUseRecall(true);
                    setRecallBranch(branch);
                  }
                }}
              />
              <button
                onClick={() => toggleContextSetting("smart_context", !smartContext)}
                aria-pressed={smartContext}
                title="Compress older turns of long chats so the model remembers more with fewer tokens"
                className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
                  smartContext
                    ? "border-primary/60 bg-primary/15 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                Smart context {smartContext ? "on" : "off"}
              </button>
              {stenographerConfigured && (
                <button
                  onClick={() => toggleContextSetting("deep_memory", !deepMemory)}
                  aria-pressed={deepMemory}
                  title="Recall decisions, people, and topics from across all your conversations"
                  className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
                    deepMemory
                      ? "border-primary/60 bg-primary/15 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Network className="h-3.5 w-3.5" />
                  Deep memory {deepMemory ? "on" : "off"}
                </button>
              )}
              {hasToolkit && (
                <button
                  onClick={() => setUseTools((v) => !v)}
                  aria-pressed={useTools}
                  title="Dispatch intents to your compiled MCP tools semantically"
                  className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
                    useTools
                      ? "border-primary/60 bg-primary/15 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Wrench className="h-3.5 w-3.5" />
                  Tools {useTools ? "on" : "off"}
                </button>
              )}
              <button
                onClick={() => setShowToolsDrawer(true)}
                title="Configure MCP servers and compile tools"
                aria-label="Open tools"
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
              >
                <Wrench className="h-3.5 w-3.5" />
                {hasToolkit ? "Manage" : "Add tools"}
              </button>
              {activeConversation && (
                <>
                  <select
                    value={activeConversation.visibility ?? "private"}
                    onChange={(e) => changeVisibility(e.target.value as "private" | "shared" | "public")}
                    className="h-9 rounded-full border border-border bg-transparent px-3 text-xs font-medium"
                    aria-label="Who can see this chat"
                    title="Chats are private unless you share them"
                  >
                    <option value="private">Private</option>
                    <option value="shared">Shared — link only</option>
                    <option value="public">Public</option>
                  </select>
                  {(activeConversation.visibility === "shared" ||
                    activeConversation.visibility === "public") &&
                    activeConversation.share_slug && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `${window.location.origin}/c/${activeConversation.share_slug}`
                          );
                          setCopiedLink(true);
                          setTimeout(() => setCopiedLink(false), 2000);
                        }}
                        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                      >
                        {copiedLink ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                        {copiedLink ? "Copied" : "Copy link"}
                      </button>
                    )}
                </>
              )}
              <JsxImportButton
                label="Import .jsx"
                size="sm"
                className="h-9 gap-1.5 rounded-full font-medium"
                tags={["chat"]}
                onSaved={handleJsxImported}
                onError={(message) => setJsxImportNotice(message)}
                showResult={false}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBackendForm((s) => !s)}
                className="ml-auto h-9 gap-1.5 rounded-full font-medium"
              >
                <Settings2 className="h-3.5 w-3.5" />
                {showBackendForm ? "Hide backends" : "Backends"}
              </Button>
            </div>
          </div>

          {jsxImportNotice && (
            <p className="text-xs text-accent" role="status">
              {jsxImportNotice}
            </p>
          )}

          {showBackendForm && (
            <BackendManager
              backends={backends}
              onChange={(next) => {
                setBackends(next);
                if (!next.find((b) => b.id === backendId)) setBackendId(next[0]?.id ?? "");
              }}
            />
          )}

          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={
                activeBackend
                  ? `Message ${activeBackend.name}… (memories from your vault come along)`
                  : "Connect a backend to start chatting"
              }
              className="min-h-[44px] min-w-0 flex-1 resize-none"
            />
            <Button onClick={send} disabled={busy || !draft.trim() || !backendId}>
              Send
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function WikiRecallControl({
  useRecall,
  recallBranch,
  branches,
  onToggle,
  onSelect,
}: {
  useRecall: boolean;
  recallBranch: string;
  branches: RecallBranch[];
  onToggle: () => void;
  onSelect: (branch: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const multiBranch = branches.length > 1;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pillClass = (active: boolean) =>
    `inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
      active
        ? "border-primary/60 bg-primary/15 text-foreground"
        : "border-border text-muted-foreground hover:bg-muted"
    }`;

  if (!multiBranch) {
    return (
      <button onClick={onToggle} aria-pressed={useRecall} className={pillClass(useRecall)}>
        <BookOpenCheck className="h-3.5 w-3.5" />
        Wiki recall {useRecall ? "on" : "off"}
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose which branch of your memory wiki grounds this chat"
        className={pillClass(useRecall)}
      >
        <BookOpenCheck className="h-3.5 w-3.5" />
        {useRecall ? (
          <>
            Wiki recall
            <span className="inline-flex items-center gap-1 font-mono opacity-80">
              <GitBranch className="h-3 w-3" />
              {recallBranch}
            </span>
          </>
        ) : (
          "Wiki recall off"
        )}
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-1 min-w-48 rounded-lg border bg-background p-1 shadow-md"
        >
          <button
            role="menuitemradio"
            aria-checked={!useRecall}
            onClick={() => {
              onSelect(null);
              setOpen(false);
            }}
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
          >
            <span className="text-muted-foreground">Off</span>
            {!useRecall && <Check className="h-3.5 w-3.5 text-accent" />}
          </button>
          <div className="my-1 border-t" />
          {branches.map((b) => {
            const active = useRecall && recallBranch === b.name;
            return (
              <button
                key={b.name}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onSelect(b.name);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
              >
                <span className="inline-flex items-center gap-1.5 font-mono">
                  <GitBranch className="h-3 w-3 opacity-70" />
                  {b.name}
                  <span className="opacity-50">{b.memory_count}</span>
                </span>
                {active && <Check className="h-3.5 w-3.5 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BackendManager({
  backends,
  onChange,
}: {
  backends: BackendRow[];
  onChange: (next: BackendRow[]) => void;
}) {
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const spec = PROVIDERS[provider];
  const isCustom = isCustomProvider(provider);

  async function add() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/backends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          api_key: apiKey || undefined,
          base_url: baseUrl || undefined,
          default_model: model || undefined,
          embedding_model: embeddingModel || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not connect the backend.");
        return;
      }
      onChange([data.backend, ...backends]);
      setNotice(data.message ?? "Connected.");
      setApiKey("");
      setBaseUrl("");
      setModel("");
      setEmbeddingModel("");
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch("/api/backends", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) onChange(backends.filter((b) => b.id !== id));
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <select
          value={isCustom ? "custom" : provider}
          onChange={(e) => setProvider(e.target.value as ProviderId)}
          className="h-10 w-full min-w-0 rounded-md border bg-transparent px-2 text-sm sm:h-9 sm:w-auto"
          aria-label="Provider"
        >
          {Object.values(PROVIDERS)
            .filter((p) => p.id !== "custom-anthropic")
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === "custom" ? "Custom endpoint" : p.label}
              </option>
            ))}
        </select>
        {isCustom && (
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderId)}
            className="h-10 w-full min-w-0 rounded-md border bg-transparent px-2 text-sm sm:h-9 sm:w-auto"
            aria-label="API style"
          >
            <option value="custom">OpenAI-compatible API</option>
            <option value="custom-anthropic">Anthropic-compatible API</option>
          </select>
        )}
        {(spec.requiresKey || spec.optionalKey) && (
          <Input
            type="password"
            placeholder={spec.requiresKey ? "API key" : "API key (optional)"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="h-10 w-full sm:h-9 sm:w-48"
          />
        )}
        <Input
          placeholder={spec.defaultModel ? `Model (${spec.defaultModel})` : "Model"}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="h-10 w-full sm:h-9 sm:w-44"
        />
        {(isCustom || provider === "ollama" || provider === "lmstudio") && (
          <Input
            placeholder={
              spec.defaultBaseUrl ||
              (provider === "custom-anthropic"
                ? "Base URL (e.g. https://api.example.com)"
                : "Base URL (e.g. https://ollama.com/v1)")
            }
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="h-10 w-full sm:h-9 sm:w-56"
          />
        )}
        {spec.protocol === "openai" && (
          <Input
            placeholder={
              spec.defaultEmbeddingModel
                ? `Embedding model (${spec.defaultEmbeddingModel})`
                : "Embedding model (optional, 1536-dim)"
            }
            value={embeddingModel}
            onChange={(e) => setEmbeddingModel(e.target.value)}
            className="h-10 w-full sm:h-9 sm:w-56"
          />
        )}
        <Button
          size="sm"
          onClick={add}
          className="h-10 w-full sm:h-8 sm:w-auto"
          disabled={
            busy ||
            (spec.requiresKey && !apiKey) ||
            (isCustom && (!baseUrl.trim() || !model.trim()))
          }
        >
          {busy ? "Testing…" : "Connect"}
        </Button>
      </div>
      {busy && (
        <p className="text-xs text-muted-foreground">
          Sending a test message to verify the endpoint…
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {notice && <p className="text-xs text-accent">{notice}</p>}
      {backends.length > 0 && (
        <ul className="flex flex-col gap-1">
          {backends.map((b) => (
            <li key={b.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="secondary">{b.provider}</Badge>
                <span>{b.name}</span>
                {b.default_model && (
                  <span className="font-mono text-muted-foreground">{b.default_model}</span>
                )}
                {(b.embedding_model || b.provider === "openai") && (
                  <Badge variant="outline" title={`Semantic recall via ${b.embedding_model ?? "text-embedding-3-small"}`}>
                    embeddings
                  </Badge>
                )}
                {b.base_url && (
                  <span className="max-w-48 truncate font-mono text-muted-foreground">
                    {b.base_url}
                  </span>
                )}
                {b.key_hint && <span className="font-mono text-muted-foreground">{b.key_hint}</span>}
                <button
                  onClick={() => setEditingId((id) => (id === b.id ? null : b.id))}
                  className="ml-auto text-accent underline underline-offset-4"
                >
                  {editingId === b.id ? "Close" : "Edit"}
                </button>
                <button
                  onClick={() => remove(b.id)}
                  className="text-destructive underline underline-offset-4"
                >
                  Disconnect
                </button>
              </div>
              {editingId === b.id && (
                <BackendEditor
                  backend={b}
                  onSaved={(updated, message) => {
                    onChange(backends.map((x) => (x.id === updated.id ? updated : x)));
                    setNotice(message);
                    setError(null);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Keys are encrypted at rest and never sent to the browser. Local backends (Ollama, LM
        Studio) need no key, but this server must be able to reach them — on the hosted app, use
        a tunnel URL (ngrok, Tailscale Funnel) or a cloud endpoint instead of localhost.
      </p>
      <p className="text-xs text-muted-foreground">
        Semantic memory recall needs an embedding model on an OpenAI-compatible backend. OpenAI
        backends use text-embedding-3-small automatically; for other endpoints, set an embedding
        model that returns 1536-dim vectors — it&apos;s verified when you connect.
      </p>
    </div>
  );
}

function BackendEditor({
  backend,
  onSaved,
  onCancel,
}: {
  backend: BackendRow;
  onSaved: (updated: BackendRow, message: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(backend.name);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(backend.base_url ?? "");
  const [model, setModel] = useState(backend.default_model ?? "");
  const [embeddingModel, setEmbeddingModel] = useState(backend.embedding_model ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spec = PROVIDERS[backend.provider as ProviderId];
  const isCustom = backend.provider === "custom";
  const showBaseUrl =
    isCustom || backend.provider === "ollama" || backend.provider === "lmstudio" || !!backend.base_url;
  const hasKey = !!backend.key_hint || spec?.requiresKey || spec?.optionalKey;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backends", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: backend.id,
          name,
          api_key: apiKey || undefined,
          base_url: baseUrl,
          default_model: model,
          embedding_model: spec?.protocol === "openai" ? embeddingModel : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not update the backend.");
        return;
      }
      onSaved(data.backend, data.message ?? "Updated.");
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background/60 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-10 w-full sm:h-9 sm:w-40"
          aria-label="Backend name"
        />
        {hasKey && (
          <Input
            type="password"
            placeholder={backend.key_hint ? `Key (kept: ${backend.key_hint})` : "API key"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="h-10 w-full sm:h-9 sm:w-48"
            aria-label="API key"
          />
        )}
        <Input
          placeholder={spec?.defaultModel ? `Model (${spec.defaultModel})` : "Model"}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="h-10 w-full sm:h-9 sm:w-44"
          aria-label="Default model"
        />
        {showBaseUrl && (
          <Input
            placeholder={spec?.defaultBaseUrl || "Base URL"}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="h-10 w-full sm:h-9 sm:w-56"
            aria-label="Base URL"
          />
        )}
        {spec?.protocol === "openai" && (
          <Input
            placeholder={
              spec.defaultEmbeddingModel
                ? `Embedding model (${spec.defaultEmbeddingModel})`
                : "Embedding model (optional, 1536-dim)"
            }
            value={embeddingModel}
            onChange={(e) => setEmbeddingModel(e.target.value)}
            className="h-10 w-full sm:h-9 sm:w-56"
            aria-label="Embedding model"
          />
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={save}
            className="h-10 flex-1 sm:h-8 sm:flex-none"
            disabled={busy || (isCustom && (!baseUrl.trim() || !model.trim()))}
          >
            {busy ? "Testing…" : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy} className="h-10 sm:h-8">
            Cancel
          </Button>
        </div>
      </div>
      {busy && (
        <p className="text-xs text-muted-foreground">
          Re-verifying the endpoint before saving…
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Leave the key blank to keep the current one. Changes to the key, model, or Base URL are
        re-tested before they&apos;re saved.
      </p>
    </div>
  );
}
