import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { sendChat } from "@/lib/backends/chat";
import { decryptSecret } from "@/lib/backends/crypto";
import type { CanonicalMessage } from "@/lib/chat/canonical";
import { feedbackPreferenceContext } from "@/lib/chat/feedback";
import { syncConversationMemory } from "@/lib/chat/memory-sync";
import { loadChatContextSettings } from "@/lib/chat/settings";
import { isMissingToolkitColumn } from "@/lib/backends/schema-compat";
import { DEFAULT_BRANCH, getBranchByName, type BranchRow } from "@/lib/mind/branches";
import { buildRecallQuery, recallArtifacts, recallContext, recallMemories } from "@/lib/recall";
import { compactChatHistory } from "@/lib/shorthand/compact";
import {
  formatToolResultBlock,
  MAX_TOOL_ITERATIONS,
  parseIntentCall,
  toolSystemPrompt,
} from "@/lib/smallchat/intent";
import { dispatchExact, humanizeToolName, lexicalResolve, listToolkitTools } from "@/lib/smallchat/fallback";
import { describeEmbedder, isLexicalEmbedder, onnxDiagnostics } from "@/lib/smallchat/embedder";
import { hydrateToolkit, loadActiveToolkit, loadToolkit } from "@/lib/smallchat/runtime";
import type { ToolResult } from "@/lib/vendor/smallchat/core/types";
import { isPolyticianConfigured } from "@/lib/polytician/client";
import { isStenographerConfigured, stenographerRecall } from "@/lib/stenographer/client";
import { appendTranscript } from "@/lib/stenographer/log";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

const MAX_MESSAGE_CHARS = 100_000;
const HISTORY_LIMIT = 200;
const HISTORY_LIMIT_COMPACTED = 1_000;

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const backendId = typeof body.backend_id === "string" ? body.backend_id : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : "";
  const useRecall = body.use_recall !== false;
  const recallBranchName =
    typeof body.recall_branch === "string" && body.recall_branch.trim() ? body.recall_branch.trim() : undefined;
  const smartContextOverride =
    typeof body.use_smart_context === "boolean" ? body.use_smart_context : undefined;
  const deepMemoryOverride =
    typeof body.use_deep_memory === "boolean" ? body.use_deep_memory : undefined;
  const useTools = typeof body.use_tools === "boolean" ? body.use_tools : undefined;
  const toolChoice = parseToolChoice(body.tool_choice);
  const polyticianOverride =
    typeof body.use_polytician === "boolean" ? body.use_polytician : undefined;

  if (!backendId) return NextResponse.json({ error: "backend_id is required." }, { status: 400 });
  if (!message) return NextResponse.json({ error: "message is required." }, { status: 400 });
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: "Message is too long." }, { status: 413 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }
  const userId = auth.identity.userId;

  const { data: backend } = await admin
    .from("llm_backends")
    .select("id, name, provider, base_url, default_model, api_key_cipher")
    .eq("id", backendId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!backend) return NextResponse.json({ error: "Backend not found — connect one first." }, { status: 404 });

  let convoId = conversationId;
  let convoTitle = message.slice(0, 80);
  let convoMemoryId: string | null = null;
  let convoToolkitId: string | null = null;
  let memorySyncAvailable = true;
  let toolkitColumnAvailable = true;
  if (convoId) {
    let { data: convo, error: convoError } = await admin
      .from("conversations")
      .select("id, title, memory_id, toolkit_id")
      .eq("id", convoId)
      .eq("user_id", userId)
      .maybeSingle();
    if (convoError && isMissingToolkitColumn(convoError)) {
      toolkitColumnAvailable = false;
      ({ data: convo, error: convoError } = await admin
        .from("conversations")
        .select("id, title, memory_id")
        .eq("id", convoId)
        .eq("user_id", userId)
        .maybeSingle());
    }
    if (convoError && /memory_id/i.test(convoError.message)) {
      memorySyncAvailable = false;
      ({ data: convo } = await admin
        .from("conversations")
        .select("id, title")
        .eq("id", convoId)
        .eq("user_id", userId)
        .maybeSingle());
    }
    if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    convoTitle = convo.title;
    convoMemoryId = "memory_id" in convo ? ((convo.memory_id as string | null) ?? null) : null;
    convoToolkitId = "toolkit_id" in convo ? ((convo.toolkit_id as string | null) ?? null) : null;
  } else {
    const activeToolkit = useTools === false ? null : await loadActiveToolkit(admin, userId);
    let { data: created, error } = await admin
      .from("conversations")
      .insert({
        user_id: userId,
        title: message.slice(0, 80),
        source_platform: "hypervault",
        model: backend.default_model,
        ...(activeToolkit ? { toolkit_id: activeToolkit.id } : {}),
      })
      .select("id")
      .single();
    if (error && activeToolkit && isMissingToolkitColumn(error)) {
      toolkitColumnAvailable = false;
      ({ data: created, error } = await admin
        .from("conversations")
        .insert({
          user_id: userId,
          title: message.slice(0, 80),
          source_platform: "hypervault",
          model: backend.default_model,
        })
        .select("id")
        .single());
    }
    if (error || !created) {
      return NextResponse.json({ error: "Could not create the conversation." }, { status: 500 });
    }
    convoId = created.id;
    convoToolkitId = toolkitColumnAvailable ? (activeToolkit?.id ?? null) : null;
  }

  const settings = await loadChatContextSettings(admin, userId);
  const useSmartContext = smartContextOverride ?? settings.smartContext;
  const useDeepMemory = (deepMemoryOverride ?? settings.deepMemory) && isStenographerConfigured();
  const usePolytician = (polyticianOverride ?? settings.polytician) && isPolyticianConfigured();

  const { data: history } = await admin
    .from("messages")
    .select("role, content, attachments, position")
    .eq("conversation_id", convoId)
    .order("position", { ascending: false })
    .limit(useSmartContext ? HISTORY_LIMIT_COMPACTED : HISTORY_LIMIT);
  const ordered = (history ?? []).reverse();
  const nextPosition = ordered.length > 0 ? ordered[ordered.length - 1].position + 1 : 0;

  const canonical: CanonicalMessage[] = ordered.map((m) => ({
    role: m.role,
    content: m.content,
    attachments: Array.isArray(m.attachments) ? m.attachments : [],
  }));
  canonical.push({ role: "user", content: message, attachments: [] });

  let recalled: { title: string; slug: string }[] = [];
  let recalledMemories: string[] = [];
  const recallQuery = buildRecallQuery(message, ordered);

  let recallBranch: BranchRow | null = null;
  if (useRecall && recallBranchName && recallBranchName !== DEFAULT_BRANCH) {
    try {
      recallBranch = await getBranchByName(admin, userId, recallBranchName);
    } catch {
      recallBranch = null;
    }
  }

  const [deepMemory, artifacts, memories] = await Promise.all([
    useDeepMemory ? stenographerRecall(recallQuery) : Promise.resolve(null),
    useRecall ? recallArtifacts(admin, userId, recallQuery) : Promise.resolve([]),
    useRecall
      ? recallMemories(admin, userId, recallQuery, {
          polyticianRerank: usePolytician,
          branch: recallBranch ? { id: recallBranch.id, isDefault: recallBranch.is_default } : undefined,
        })
      : Promise.resolve([]),
  ]);

  const systemBlocks: string[] = [];
  if (deepMemory) systemBlocks.push(deepMemory.contextBlock);
  if (useRecall) {
    const wikiBlock = recallContext(artifacts, memories);
    if (wikiBlock) systemBlocks.push(wikiBlock);
    recalled = artifacts.map((a) => ({ title: a.title, slug: a.slug }));
    recalledMemories = memories.map((m) => m.title);
  }

  const compacted = useSmartContext ? await compactChatHistory(canonical) : null;
  if (compacted) systemBlocks.push(compacted.contextBlock);
  const wireMessages = compacted ? compacted.keptMessages : canonical;

  const preferences = await feedbackPreferenceContext(admin, userId);
  if (preferences) systemBlocks.push(preferences);

  let toolsStatus: "ok" | "off" | "stale" = "off";
  let toolkitRuntime: import("@/lib/vendor/smallchat/runtime/runtime").ToolRuntime | null = null;
  let toolkitIdUsed: string | null = null;
  let toolsEmbedder: ToolsEmbedderInfo | null = null;
  let providerNames: Record<string, string> = {};
  if (useTools !== false && toolkitColumnAvailable) {
    let toolkit = convoToolkitId ? await loadToolkit(admin, userId, convoToolkitId) : null;
    if (!toolkit && (convoToolkitId || useTools === true)) {
      toolkit = await loadActiveToolkit(admin, userId);
    }
    if (toolkit) {
      const hydrated = await hydrateToolkit(admin, userId, toolkit);
      if (hydrated.ok) {
        toolkitRuntime = hydrated.runtime;
        toolkitIdUsed = toolkit.id;
        toolsStatus = "ok";
        providerNames = Object.fromEntries(
          Object.entries(toolkit.endpoints).map(([pid, ep]) => [pid, ep.name])
        );
        if (toolkit.header) systemBlocks.push(toolSystemPrompt(toolkit.header));
        const lexical = isLexicalEmbedder(hydrated.embedder);
        toolsEmbedder = {
          label: describeEmbedder(hydrated.embedder),
          lexical,
          upgrade_available: false,
          onnx_error: lexical ? onnxDiagnostics().error : null,
        };
      } else {
        toolsStatus = "stale";
        if (hydrated.reason === "embedder_mismatch") {
          toolsEmbedder = {
            label: describeEmbedder(hydrated.stored),
            lexical: isLexicalEmbedder(hydrated.stored),
            upgrade_available: hydrated.upgrade,
            available_label: describeEmbedder(hydrated.available),
            detail: hydrated.detail,
            onnx_error: null,
          };
        }
      }
    }
  }
  const system = systemBlocks.join("\n\n");

  const backendConfig = {
    provider: backend.provider,
    baseUrl: backend.base_url,
    model: backend.default_model,
    apiKey: backend.api_key_cipher ? decryptSecret(backend.api_key_cipher) : null,
  };

  const TOOL_LOOP_DEADLINE_MS = 90_000;
  const DISPATCH_TIMEOUT_MS = 30_000;
  const deadline = Date.now() + TOOL_LOOP_DEADLINE_MS;
  const toolTurns: ToolTurnRecord[] = [];
  const extraTurns: CanonicalMessage[] = [];
  let current = wireMessages;
  let reply;
  let budgetExhausted = false;
  let toolSelection: ToolSelection | null = null;
  try {
    if (toolkitRuntime && toolChoice) {
      const call = { intent: humanizeToolName(toolChoice.canonical), args: toolChoice.args };
      const result = await dispatchExact(toolkitRuntime, toolChoice.canonical, toolChoice.args);
      recordToolTurn(toolTurns, call, result, {
        resolvedTool: toolChoice.canonical.split(".").slice(1).join(".") || null,
      });
      const pair: CanonicalMessage[] = [
        { role: "assistant", content: "```tool\n" + JSON.stringify(call) + "\n```", attachments: [] },
        { role: "tool", content: formatToolResultBlock(call, result), attachments: [] },
      ];
      extraTurns.push(...pair);
      current = [...current, ...pair];
    }

    for (let i = 0; ; i++) {
      reply = await sendChat(backendConfig, current, system || undefined);
      if (!toolkitRuntime) break;
      const parsed = parseIntentCall(reply.text);
      if (!parsed) break;
      if (i >= MAX_TOOL_ITERATIONS || Date.now() > deadline) {
        budgetExhausted = true;
        break;
      }

      let result = await dispatchWithTimeout(toolkitRuntime, parsed.call.intent, parsed.call.args, DISPATCH_TIMEOUT_MS);
      let resolvedTool: string | null = null;

      if (result.refinement) {
        const lex = lexicalResolve(toolkitRuntime, parsed.call.intent);
        if (lex.kind === "resolved") {
          result = await dispatchExact(toolkitRuntime, lex.canonical, parsed.call.args);
          resolvedTool = lex.toolName;
        }
      }

      recordToolTurn(toolTurns, parsed.call, result, { resolvedTool });
      const pair: CanonicalMessage[] = [
        { role: "assistant", content: reply.text, attachments: [] },
        { role: "tool", content: formatToolResultBlock(parsed.call, result), attachments: [] },
      ];
      extraTurns.push(...pair);
      current = [...current, ...pair];

      if (result.refinement) {
        const selection = buildToolSelection(toolkitRuntime, parsed.call, result.refinement, providerNames);
        if (selection.options.length > 0) toolSelection = selection;
        break;
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The backend request failed." },
      { status: 502 }
    );
  }
  if (budgetExhausted && reply) {
    const parsed = parseIntentCall(reply.text);
    const visible = parsed ? parsed.visibleText : reply.text;
    reply = { ...reply, text: `${visible}\n\n(Tool budget for this turn was exhausted.)`.trim() };
    if (!toolSelection && toolkitRuntime) {
      const lastIntent = parsed?.call.intent ?? "";
      toolSelection = buildManualToolSelection(toolkitRuntime, lastIntent, providerNames);
    }
  }
  if (toolSelection && reply) {
    const parsed = parseIntentCall(reply.text);
    const visible = parsed ? parsed.visibleText : reply.text;
    const PLAIN_TEXT_CAP = 12;
    const shown = toolSelection.options.slice(0, PLAIN_TEXT_CAP);
    const list = shown.map((o, n) => `${n + 1}. ${o.label}`).join("\n");
    const more = toolSelection.options.length - shown.length;
    const tail = more > 0 ? `\n…and ${more} more` : "";
    reply = { ...reply, text: `${visible}\n\n${toolSelection.question}\n${list}${tail}`.trim() };
  }

  if (!reply) {
    return NextResponse.json({ error: "The backend request failed." }, { status: 502 });
  }

  const rows = [
    { conversation_id: convoId, user_id: userId, role: "user", content: message },
    ...extraTurns.map((t) => ({
      conversation_id: convoId,
      user_id: userId,
      role: t.role,
      content: t.content,
    })),
    { conversation_id: convoId, user_id: userId, role: "assistant", content: reply.text, model: reply.model },
  ].map((row, i) => ({ ...row, position: nextPosition + i }));

  const { data: saved, error: insertError } = await admin.from("messages").insert(rows).select("id, role, position");
  if (insertError) {
    return NextResponse.json({ error: `Reply received but not saved: ${insertError.message}` }, { status: 500 });
  }
  const assistantRows = (saved ?? []).filter((m) => m.role === "assistant");
  const assistantMessageId =
    assistantRows.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).pop()?.id ?? null;

  void appendTranscript(convoId, [
    { role: "user", content: message },
    { role: "assistant", content: reply.text },
  ]);

  await admin
    .from("conversations")
    .update({ updated_at: new Date().toISOString(), model: reply.model })
    .eq("id", convoId);
  void admin.from("llm_backends").update({ last_used_at: new Date().toISOString() }).eq("id", backend.id);

  if (memorySyncAvailable) {
    try {
      await syncConversationMemory(
        admin,
        auth.identity,
        { id: convoId, title: convoTitle, memoryId: convoMemoryId },
        [...canonical, { role: "assistant", content: reply.text }]
      );
    } catch {
    }
  }

  return NextResponse.json({
    conversation_id: convoId,
    reply: {
      id: assistantMessageId,
      role: "assistant",
      content: reply.text,
      model: reply.model,
      truncated: reply.truncated,
    },
    backend: { id: backend.id, name: backend.name, provider: backend.provider },
    recalled,
    recalled_memories: recalledMemories,
    recall_branch: useRecall ? (recallBranch?.name ?? DEFAULT_BRANCH) : null,
    smart_context: Boolean(compacted),
    deep_memory: deepMemory ? deepMemory.labels : null,
    tools: { status: toolsStatus, toolkit_id: toolkitIdUsed, turns: toolTurns, embedder: toolsEmbedder },
    tool_selection: toolSelection,
  });
}

type ToolsEmbedderInfo = {
  label: string;
  lexical: boolean;
  upgrade_available: boolean;
  available_label?: string;
  detail?: string;
  onnx_error?: string | null;
};

type ToolTurnRecord = {
  intent: string;
  tool: string | null;
  ok: boolean;
  confidence?: number;
  tier?: string;
  preview: string;
  error?: string;
  refinement?: { question: string; options: Array<{ label: string; intent: string; canonical?: string }> };
};

type ToolSelection = {
  intent: string;
  question: string;
  options: Array<{ label: string; canonical: string; args: Record<string, unknown> }>;
};

function parseToolChoice(
  raw: unknown
): { canonical: string; args: Record<string, unknown> } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const canonical = typeof obj.canonical === "string" ? obj.canonical.trim() : "";
  if (!canonical) return null;
  const args =
    obj.args && typeof obj.args === "object" && !Array.isArray(obj.args)
      ? (obj.args as Record<string, unknown>)
      : {};
  return { canonical, args };
}

function recordToolTurn(
  turns: ToolTurnRecord[],
  call: { intent: string; args: Record<string, unknown> },
  result: import("@/lib/vendor/smallchat/core/types").ToolResult,
  opts: { resolvedTool: string | null }
): void {
  const metadata = (result.metadata ?? {}) as {
    confidence?: number;
    tier?: string;
    proof?: { resolvedTool?: string };
  };
  const refinement = result.refinement;
  turns.push({
    intent: call.intent,
    tool: opts.resolvedTool ?? metadata.proof?.resolvedTool ?? null,
    ok: !result.isError && !refinement,
    ...(typeof metadata.confidence === "number" ? { confidence: metadata.confidence } : {}),
    ...(metadata.tier ? { tier: metadata.tier } : {}),
    preview:
      typeof result.content === "string"
        ? result.content.slice(0, 300)
        : JSON.stringify(result.content ?? null).slice(0, 300),
    ...(result.isError && !refinement && typeof result.content === "string"
      ? { error: result.content.slice(0, 2_000) }
      : {}),
    ...(refinement
      ? {
          refinement: {
            question: refinement.question,
            options: refinement.options.map((o) => ({
              label: o.label,
              intent: o.intent,
              ...(o.canonical ? { canonical: o.canonical } : {}),
            })),
          },
        }
      : {}),
  });
}

function buildToolSelection(
  runtime: import("@/lib/vendor/smallchat/runtime/runtime").ToolRuntime,
  call: { intent: string; args: Record<string, unknown> },
  refinement: import("@/lib/vendor/smallchat/core/types").ToolRefinementNeeded,
  providerNames: Record<string, string>
): ToolSelection {
  const options = refinement.options
    .filter((o): o is typeof o & { canonical: string } => typeof o.canonical === "string")
    .filter((o) => runtime.context.classesForSelector(o.canonical).length > 0)
    .map((o) => {
      const providerId = o.canonical.slice(0, o.canonical.indexOf("."));
      const server = providerNames[providerId];
      return {
        label: server ? `${server}: ${o.label}` : o.label,
        canonical: o.canonical,
        args: call.args,
      };
    });
  return { intent: call.intent, question: refinement.question, options };
}

function buildManualToolSelection(
  runtime: import("@/lib/vendor/smallchat/runtime/runtime").ToolRuntime,
  intent: string,
  providerNames: Record<string, string>
): ToolSelection | null {
  const options = listToolkitTools(runtime).map((t) => {
    const server = providerNames[t.providerId];
    return {
      label: server ? `${server}: ${t.label}` : t.label,
      canonical: t.canonical,
      args: {} as Record<string, unknown>,
    };
  });
  if (options.length === 0) return null;
  return {
    intent,
    question: "I couldn't run that automatically. Pick the tool you want and I'll run it directly:",
    options,
  };
}

async function dispatchWithTimeout(
  runtime: import("@/lib/vendor/smallchat/runtime/runtime").ToolRuntime,
  intent: string,
  args: Record<string, unknown>,
  timeoutMs: number
): Promise<ToolResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ToolResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ content: `The tool call timed out after ${Math.round(timeoutMs / 1000)}s.`, isError: true }),
      timeoutMs
    );
  });
  try {
    return await Promise.race([
      runtime.dispatch(intent, args).catch(
        (err): ToolResult => ({
          content: err instanceof Error ? err.message : "Dispatch failed.",
          isError: true,
        })
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
