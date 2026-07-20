import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { embedMemoryBestEffort } from "@/lib/backends/embeddings";
import { generateDigestForMemory } from "@/lib/digestion";
import { hybridRecallMemories, type RecallMode } from "@/lib/memory-recall";
import {
  autoTags,
  autoTitle,
  scoreRecall,
  suggestLinkChangesForMemory,
  summarize,
  syncArtifactLinksForMemory,
} from "@/lib/memory";
import { resolveBranch, type BranchRow } from "@/lib/mind/branches";
import { recordCommit } from "@/lib/mind/commits";
import { provenanceForMemories } from "@/lib/mind/provenance";
import { branchState } from "@/lib/mind/state";
import type { LinkChange } from "@/lib/mind/types";
import { isThoughtFormV1, memoryToThoughtForm, type ThoughtFormV1 } from "@/lib/polytician/thoughtform";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_CONTENT_BYTES = 500_000;
const MAX_RECALL_RESULTS = 20;
const RECALL_CONTENT_TOP = 3;

type MemoryRow = {
  id: string;
  title: string;
  summary: string;
  tags: string[] | null;
  source: string;
  content: string;
  created_at: string;
};

async function loadStoredThoughtForms(
  admin: SupabaseClient,
  userId: string,
  memoryIds: string[]
): Promise<Map<string, ThoughtFormV1>> {
  const map = new Map<string, ThoughtFormV1>();
  if (memoryIds.length === 0) return map;
  const { data } = await admin
    .from("polytician_concepts")
    .select("memory_id, thoughtform")
    .eq("user_id", userId)
    .in("memory_id", memoryIds);
  for (const row of (data ?? []) as { memory_id: string; thoughtform: unknown }[]) {
    if (isThoughtFormV1(row.thoughtform)) map.set(row.memory_id, row.thoughtform);
  }
  return map;
}

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const userId = auth.identity.userId;

  let branch: BranchRow | null;
  try {
    branch = await resolveBranch(admin, userId, req.nextUrl.searchParams.get("branch"));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Branch lookup failed." }, { status: 500 });
  }
  if (!branch) {
    return NextResponse.json({ error: "No such branch — create it first via /api/mind/branches." }, { status: 404 });
  }

  const asThoughtForm = req.nextUrl.searchParams.get("format") === "thoughtform";

  if (!q) {
    if (branch.is_default) {
      const columns = asThoughtForm
        ? "id, title, summary, tags, source, content, created_at"
        : "id, title, summary, tags, source, created_at";
      const { data, error } = await admin
        .from("memories")
        .select(columns)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (asThoughtForm) {
        const rows = (data ?? []) as unknown as MemoryRow[];
        const stored = await loadStoredThoughtForms(admin, userId, rows.map((m) => m.id));
        return NextResponse.json({
          branch: branch.name,
          memories: rows.map((m) => ({
            id: m.id,
            title: m.title,
            summary: m.summary,
            tags: m.tags,
            source: m.source,
            created_at: m.created_at,
            thoughtform:
              stored.get(m.id) ??
              memoryToThoughtForm(
                { id: m.id, title: m.title, content: m.content, summary: m.summary, tags: m.tags },
                [],
                { updatedAtMs: Date.parse(m.created_at) || 0 }
              ),
          })),
        });
      }
      return NextResponse.json({ branch: branch.name, memories: data ?? [] });
    }
    const rows = await branchState(admin, userId, branch.id);
    rows.sort((x, y) => (y.committed_at < x.committed_at ? -1 : 1));
    return NextResponse.json({
      branch: branch.name,
      memories: rows.slice(0, 200).map((r) => ({
        id: r.memory_id,
        title: r.title,
        summary: r.summary,
        tags: r.tags,
        source: r.source,
        created_at: r.committed_at,
      })),
    });
  }

  const byId = new Map<string, MemoryRow>();
  let recallMode: RecallMode = "lexical";
  let ranked: { memory: MemoryRow; score: number }[];

  if (branch.is_default) {
    try {
      const recall = await hybridRecallMemories(admin, userId, q, MAX_RECALL_RESULTS);
      recallMode = recall.mode;
      ranked = recall.ranked;
      for (const r of ranked) byId.set(r.memory.id, r.memory);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Recall failed." },
        { status: 500 }
      );
    }
  } else {
    const ftsIds = new Set<string>();
    const [ftsRows, allRows] = await Promise.all([
      branchState(admin, userId, branch.id, q),
      branchState(admin, userId, branch.id),
    ]);
    for (const r of [...ftsRows, ...allRows]) {
      if (!byId.has(r.memory_id)) {
        byId.set(r.memory_id, {
          id: r.memory_id,
          title: r.title,
          summary: r.summary,
          tags: r.tags,
          source: r.source,
          content: r.content,
          created_at: r.committed_at,
        });
      }
    }
    for (const r of ftsRows) ftsIds.add(r.memory_id);

    ranked = [...byId.values()]
      .map((m) => ({ memory: m, score: scoreRecall(q, m) + (ftsIds.has(m.id) ? 2 : 0) }))
      .filter((r) => r.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, MAX_RECALL_RESULTS);
  }

  const matchIds = ranked.map((r) => r.memory.id);
  const related = new Map<string, string[]>();
  if (matchIds.length > 0) {
    const { data: links } = await admin
      .from("memory_links")
      .select("a_id, b_id")
      .eq("user_id", userId)
      .eq("branch_id", branch.id)
      .or(`a_id.in.(${matchIds.join(",")}),b_id.in.(${matchIds.join(",")})`)
      .limit(500);
    const neighborIds = new Set<string>();
    for (const l of links ?? []) {
      neighborIds.add(l.a_id);
      neighborIds.add(l.b_id);
    }
    const unknown = [...neighborIds].filter((id) => !byId.has(id));
    if (unknown.length > 0 && branch.is_default) {
      const { data: extra } = await admin
        .from("memories")
        .select("id, title, summary, tags, source, content, created_at")
        .in("id", unknown);
      for (const row of (extra ?? []) as MemoryRow[]) byId.set(row.id, row);
    }
    for (const l of links ?? []) {
      for (const [self, other] of [[l.a_id, l.b_id], [l.b_id, l.a_id]]) {
        const title = byId.get(other)?.title;
        if (!title) continue;
        related.set(self, [...(related.get(self) ?? []), title]);
      }
    }
  }

  let provenance = new Map<string, unknown>();
  try {
    provenance = await provenanceForMemories(admin, userId, branch.id, matchIds);
  } catch {
  }

  return NextResponse.json({
    query: q,
    branch: branch.name,
    recall_mode: recallMode,
    results: ranked.map(({ memory, score }, i) => ({
      id: memory.id,
      title: memory.title,
      summary: memory.summary,
      tags: memory.tags ?? [],
      source: memory.source,
      created_at: memory.created_at,
      score,
      content: i < RECALL_CONTENT_TOP ? memory.content : undefined,
      related: related.get(memory.id) ?? [],
      provenance: provenance.get(memory.id),
    })),
    message:
      ranked.length > 0
        ? `Recalled ${ranked.length} matching memor${ranked.length === 1 ? "y" : "ies"}.`
        : "Nothing in the wiki matches that yet — memorize something first.",
  });
}

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "content is required — the text to memorize." }, { status: 400 });
  }
  if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
    return NextResponse.json(
      { error: "That chunk is over the 500 kB memory limit — split it into smaller memories." },
      { status: 413 }
    );
  }

  const title = (typeof body.title === "string" && body.title.trim()) || autoTitle(content);
  const userTags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim())
    : [];
  const tags = [...new Set([...userTags, ...autoTags(content, title)])].slice(0, 12);
  const summary = summarize(content);
  const source =
    typeof body.source === "string" && ["manual", "chat", "coding", "agent"].includes(body.source)
      ? body.source
      : auth.identity.via === "api-key"
        ? "agent"
        : "manual";

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  let branch: BranchRow | null;
  try {
    branch = await resolveBranch(admin, auth.identity.userId, typeof body.branch === "string" ? body.branch : null);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Branch lookup failed." }, { status: 500 });
  }
  if (!branch) {
    return NextResponse.json({ error: "No such branch — create it first via /api/mind/branches." }, { status: 404 });
  }

  const memoryId = crypto.randomUUID();

  let linkChanges: LinkChange[] = [];
  try {
    linkChanges = await suggestLinkChangesForMemory(admin, auth.identity.userId, branch, {
      id: memoryId,
      title,
      summary,
      tags,
    });
  } catch {
  }

  const message =
    (typeof body.message === "string" && body.message.trim()) || `memorize: ${title}`;

  let commitId: string;
  try {
    commitId = await recordCommit(
      admin,
      auth.identity,
      branch.id,
      message,
      [{ memory_id: memoryId, op: "create", title, content, summary, tags, source }],
      linkChanges
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Could not store the memory: ${err instanceof Error ? err.message : "commit failed"}` },
      { status: 500 }
    );
  }

  let links = linkChanges.length;

  if (branch.is_default) {
    try {
      links += await syncArtifactLinksForMemory(admin, auth.identity.userId, {
        id: memoryId,
        title,
        summary,
        tags,
      });
    } catch {
    }
    await embedMemoryBestEffort(admin, auth.identity.userId, memoryId, `${title}\n${content}`);
  }

  try {
    const { data: prof } = await admin
      .from("profiles")
      .select("digestion_enabled")
      .eq("id", auth.identity.userId)
      .maybeSingle();
    if (prof?.digestion_enabled) {
      await generateDigestForMemory(admin, auth.identity.userId, memoryId, branch);
    }
  } catch {
  }
  return NextResponse.json({
    id: memoryId,
    title,
    summary,
    tags,
    source,
    links,
    branch: branch.name,
    commit_id: commitId,
    message:
      links > 0
        ? `Memorized and linked to ${links} related memor${links === 1 ? "y" : "ies"} in your wiki.`
        : "Memorized — it's in your private wiki now.",
  });
}
