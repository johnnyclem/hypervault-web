import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import type { CanonicalMessage } from "@/lib/chat/canonical";
import { feedbackPreferenceContext } from "@/lib/chat/feedback";
import { loadChatContextSettings } from "@/lib/chat/settings";
import { DEFAULT_BRANCH, getBranchByName, type BranchRow } from "@/lib/mind/branches";
import { buildRecallQuery, recallArtifacts, recallContext, recallMemories } from "@/lib/recall";
import { compactChatHistory } from "@/lib/shorthand/compact";
import { isStenographerConfigured, stenographerRecall } from "@/lib/stenographer/client";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

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

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : "";
  const useRecall = body.use_recall !== false;
  const recallBranchName =
    typeof body.recall_branch === "string" && body.recall_branch.trim() ? body.recall_branch.trim() : undefined;
  const smartContextOverride =
    typeof body.use_smart_context === "boolean" ? body.use_smart_context : undefined;
  const deepMemoryOverride =
    typeof body.use_deep_memory === "boolean" ? body.use_deep_memory : undefined;

  if (!message) return NextResponse.json({ error: "message is required." }, { status: 400 });
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: "Message is too long." }, { status: 413 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }
  const userId = auth.identity.userId;

  const settings = await loadChatContextSettings(admin, userId);
  const useSmartContext = smartContextOverride ?? settings.smartContext;
  const useDeepMemory = (deepMemoryOverride ?? settings.deepMemory) && isStenographerConfigured();

  let ordered: { role: string; content: string; attachments: unknown; position: number }[] = [];
  if (conversationId) {
    const { data: convo } = await admin
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

    const { data: history } = await admin
      .from("messages")
      .select("role, content, attachments, position")
      .eq("conversation_id", conversationId)
      .order("position", { ascending: false })
      .limit(useSmartContext ? HISTORY_LIMIT_COMPACTED : HISTORY_LIMIT);
    ordered = (history ?? []).reverse();
  }
  const nextPosition = ordered.length > 0 ? ordered[ordered.length - 1].position + 1 : 0;

  const canonical: CanonicalMessage[] = ordered.map((m) => ({
    role: m.role as CanonicalMessage["role"],
    content: m.content,
    attachments: Array.isArray(m.attachments) ? (m.attachments as CanonicalMessage["attachments"]) : [],
  }));
  canonical.push({ role: "user", content: message, attachments: [] });

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
          branch: recallBranch ? { id: recallBranch.id, isDefault: recallBranch.is_default } : undefined,
        })
      : Promise.resolve([]),
  ]);

  const systemBlocks: string[] = [];
  let recalled: { title: string; slug: string }[] = [];
  let recalledMemories: string[] = [];
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

  const system = systemBlocks.join("\n\n");

  return NextResponse.json({
    conversation_id: conversationId || null,
    system,
    messages: wireMessages,
    next_position: nextPosition,
    recalled,
    recalled_memories: recalledMemories,
    recall_branch: useRecall ? (recallBranch?.name ?? DEFAULT_BRANCH) : null,
    smart_context: Boolean(compacted),
    deep_memory: deepMemory ? deepMemory.labels : null,
  });
}
