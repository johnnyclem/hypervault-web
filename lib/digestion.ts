import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiIdentity } from "@/lib/api-auth";
import { autoTags, autoTitle, memoryKeywords, summarize } from "@/lib/memory";
import { getBranchById, type BranchRow } from "@/lib/mind/branches";
import { recordCommit } from "@/lib/mind/commits";
import { headSnapshot } from "@/lib/mind/state";
import type { LinkChange, MindChange } from "@/lib/mind/types";


export type DigestStrategy = "chat" | "headings" | "rules" | "none";

export type DigestSegment = {
  ordinal: number;
  title: string;
  content: string;
  summary: string;
  tags: string[];
  reason: string;
};

export type DigestLink = { a: number; b: number; kind: "sequence" | "theme" };

export type DigestPlan = {
  strategy: DigestStrategy;
  segments: DigestSegment[];
  links: DigestLink[];
};

export const MIN_SEGMENTS = 2;
export const MAX_SEGMENTS = 40;
const MIN_SEGMENT_CHARS = 40;
const THEME_OVERLAP_MIN = 2;

const ROLE_WORDS = [
  "user", "assistant", "human", "ai", "system", "me", "you", "bot",
  "chatgpt", "gpt", "claude", "gemini", "grok", "copilot", "model",
];
const ROLE_ALT = ROLE_WORDS.join("|");
const ROLE_LINE_RE = new RegExp(
  `^\\s*(?:>+\\s*)?(?:#{1,6}\\s*)?(?:\\*\\*|__)?\\s*(${ROLE_ALT})\\s*(?:\\*\\*|__)?\\s*[:：\\-–—]`,
  "i"
);
const HEADING_RE = /^(#{1,6})\s+(\S.*)$/;
const RULE_RE = /^\s*([-*_])\1{2,}\s*$/;

function roleLabel(raw: string): string {
  const w = raw.toLowerCase();
  if (w === "ai") return "AI";
  if (w === "gpt" || w === "chatgpt") return "ChatGPT";
  return w.charAt(0).toUpperCase() + w.slice(1);
}

type RawBlock = { text: string; reason: string };

function splitChat(lines: string[]): RawBlock[] | null {
  const starts: { line: number; role: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ROLE_LINE_RE);
    if (m) starts.push({ line: i, role: roleLabel(m[1]) });
  }
  if (starts.length < MIN_SEGMENTS) return null;

  const blocks: RawBlock[] = [];
  const firstStart = starts[0].line;
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s].line;
    const to = s + 1 < starts.length ? starts[s + 1].line : lines.length;
    const bodyStart = s === 0 ? Math.min(firstStart, 0) : from;
    const text = lines.slice(s === 0 ? 0 : bodyStart, to).join("\n").trim();
    if (text) blocks.push({ text, reason: `chat turn · ${starts[s].role.toLowerCase()}` });
  }
  return blocks.length >= MIN_SEGMENTS ? blocks : null;
}

function splitHeadings(lines: string[]): RawBlock[] | null {
  const headings = lines
    .map((l, i) => ({ i, m: l.match(HEADING_RE) }))
    .filter((h): h is { i: number; m: RegExpMatchArray } => Boolean(h.m));
  if (headings.length < MIN_SEGMENTS) return null;

  const topLevel = Math.min(...headings.map((h) => h.m[1].length));
  const cuts = headings.filter((h) => h.m[1].length === topLevel);
  if (cuts.length < MIN_SEGMENTS) return null;

  const blocks: RawBlock[] = [];
  const preamble = lines.slice(0, cuts[0].i).join("\n").trim();
  if (preamble.length >= MIN_SEGMENT_CHARS) blocks.push({ text: preamble, reason: "intro" });

  for (let c = 0; c < cuts.length; c++) {
    const from = cuts[c].i;
    const to = c + 1 < cuts.length ? cuts[c + 1].i : lines.length;
    const text = lines.slice(from, to).join("\n").trim();
    const heading = cuts[c].m[2].trim().slice(0, 60);
    if (text) blocks.push({ text, reason: `section: ${heading}` });
  }
  return blocks.length >= MIN_SEGMENTS ? blocks : null;
}

function splitRules(lines: string[]): RawBlock[] | null {
  const blocks: RawBlock[] = [];
  let cur: string[] = [];
  let ruleCount = 0;
  for (const l of lines) {
    if (RULE_RE.test(l)) {
      const text = cur.join("\n").trim();
      if (text) blocks.push({ text, reason: `section ${blocks.length + 1}` });
      cur = [];
      ruleCount++;
    } else {
      cur.push(l);
    }
  }
  const tail = cur.join("\n").trim();
  if (tail) blocks.push({ text: tail, reason: `section ${blocks.length + 1}` });
  if (ruleCount === 0 || blocks.length < MIN_SEGMENTS) return null;
  return blocks;
}

function mergeToFit(blocks: RawBlock[]): RawBlock[] {
  let out = blocks.map((b) => ({ ...b }));

  const compact: RawBlock[] = [];
  for (const b of out) {
    if (b.text.length < MIN_SEGMENT_CHARS && compact.length > 0) {
      const prev = compact[compact.length - 1];
      prev.text = `${prev.text}\n\n${b.text}`.trim();
    } else {
      compact.push({ ...b });
    }
  }
  if (compact.length > 1 && compact[0].text.length < MIN_SEGMENT_CHARS) {
    compact[1].text = `${compact[0].text}\n\n${compact[1].text}`.trim();
    compact.shift();
  }
  out = compact;

  while (out.length > MAX_SEGMENTS) {
    let best = 0;
    let bestLen = Infinity;
    for (let i = 0; i < out.length - 1; i++) {
      const len = out[i].text.length + out[i + 1].text.length;
      if (len < bestLen) {
        bestLen = len;
        best = i;
      }
    }
    out[best] = {
      text: `${out[best].text}\n\n${out[best + 1].text}`.trim(),
      reason: out[best].reason,
    };
    out.splice(best + 1, 1);
  }
  return out;
}

function toSegment(block: RawBlock, ordinal: number): DigestSegment {
  const title = autoTitle(block.text);
  return {
    ordinal,
    title,
    content: block.text,
    summary: summarize(block.text),
    tags: autoTags(block.text, title),
    reason: block.reason,
  };
}

export function segmentContent(content: string): DigestPlan {
  const text = (content ?? "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const raw = splitChat(lines) ?? splitHeadings(lines) ?? splitRules(lines);
  let strategy: DigestStrategy = "none";
  if (raw) {
    if (splitChat(lines)) strategy = "chat";
    else if (splitHeadings(lines)) strategy = "headings";
    else strategy = "rules";
  }

  if (!raw) {
    const single = toSegment({ text: text.trim(), reason: "whole" }, 0);
    return { strategy: "none", segments: [single], links: [] };
  }

  const fitted = mergeToFit(raw);
  if (fitted.length < MIN_SEGMENTS) {
    const single = toSegment({ text: text.trim(), reason: "whole" }, 0);
    return { strategy: "none", segments: [single], links: [] };
  }

  const segments = fitted.map((b, i) => toSegment(b, i));
  return { strategy, segments, links: internalLinks(segments) };
}

export function internalLinks(segments: DigestSegment[]): DigestLink[] {
  const links: DigestLink[] = [];
  const seen = new Set<string>();
  const add = (a: number, b: number, kind: DigestLink["kind"]) => {
    const [x, y] = a < b ? [a, b] : [b, a];
    const key = `${x}:${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ a: x, b: y, kind });
  };

  for (let i = 0; i < segments.length - 1; i++) add(i, i + 1, "sequence");

  const profs = segments.map((s) => ({
    tags: new Set(s.tags.map((t) => t.toLowerCase())),
    words: new Set(memoryKeywords(`${s.title} ${s.summary}`)),
  }));
  for (let i = 0; i < profs.length; i++) {
    for (let j = i + 2; j < profs.length; j++) {
      let sharedTags = 0;
      for (const t of profs[i].tags) if (profs[j].tags.has(t)) sharedTags++;
      let sharedWords = 0;
      for (const w of profs[i].words) if (profs[j].words.has(w)) sharedWords++;
      if (sharedTags >= 1 || sharedWords >= THEME_OVERLAP_MIN) add(i, j, "theme");
    }
  }
  return links;
}


export type DigestRunSummary = {
  runId: string | null;
  strategy: DigestStrategy;
  segmentCount: number;
  reason?: string;
};

async function loadMemorySnapshot(
  db: SupabaseClient,
  userId: string,
  branch: BranchRow,
  memoryId: string
): Promise<{ title: string; content: string; source: string } | null> {
  try {
    const head = await headSnapshot(db, userId, branch.id, memoryId);
    if (head) return { title: head.title, content: head.content, source: head.source };
  } catch {
  }
  if (branch.is_default) {
    const { data } = await db
      .from("memories")
      .select("title, content, source")
      .eq("user_id", userId)
      .eq("id", memoryId)
      .maybeSingle();
    if (data) return { title: data.title, content: data.content, source: data.source };
  }
  return null;
}

export async function generateDigestForMemory(
  db: SupabaseClient,
  userId: string,
  memoryId: string,
  branch: BranchRow
): Promise<DigestRunSummary> {
  const snap = await loadMemorySnapshot(db, userId, branch, memoryId);
  if (!snap) return { runId: null, strategy: "none", segmentCount: 0, reason: "That memory no longer exists." };

  const plan = segmentContent(snap.content);
  if (plan.strategy === "none" || plan.segments.length < MIN_SEGMENTS) {
    return {
      runId: null,
      strategy: "none",
      segmentCount: 1,
      reason: "This reads as a single thought — no natural split to make.",
    };
  }

  const { data: existing } = await db
    .from("digest_runs")
    .select("id, strategy, segment_count")
    .eq("user_id", userId)
    .eq("source_memory_id", memoryId)
    .eq("status", "pending")
    .maybeSingle();
  if (existing) {
    return {
      runId: existing.id as string,
      strategy: existing.strategy as DigestStrategy,
      segmentCount: existing.segment_count as number,
      reason: "This memory already has a digest waiting for review.",
    };
  }

  const newMemoryIds = plan.segments.map(() => crypto.randomUUID());

  const { data: run, error: runErr } = await db
    .from("digest_runs")
    .insert({
      user_id: userId,
      source_memory_id: memoryId,
      branch_id: branch.id,
      source_title: snap.title,
      strategy: plan.strategy,
      segment_count: plan.segments.length,
    })
    .select("id")
    .single();
  if (runErr || !run) {
    if (runErr?.code === "23505") {
      const { data: raced } = await db
        .from("digest_runs")
        .select("id, strategy, segment_count")
        .eq("user_id", userId)
        .eq("source_memory_id", memoryId)
        .eq("status", "pending")
        .maybeSingle();
      if (raced) {
        return {
          runId: raced.id as string,
          strategy: raced.strategy as DigestStrategy,
          segmentCount: raced.segment_count as number,
          reason: "This memory already has a digest waiting for review.",
        };
      }
    }
    throw new Error(`Could not open a digest run: ${runErr?.message ?? "insert failed"}`);
  }

  const rows = plan.segments.map((s, i) => ({
    run_id: run.id,
    user_id: userId,
    ordinal: s.ordinal,
    new_memory_id: newMemoryIds[i],
    title: s.title,
    content: s.content,
    summary: s.summary,
    tags: s.tags,
    reason: s.reason,
  }));
  const { error: segErr } = await db.from("digest_segments").insert(rows);
  if (segErr) {
    await db.from("digest_runs").delete().eq("id", run.id);
    throw new Error(`Could not stage digest segments: ${segErr.message}`);
  }

  return { runId: run.id as string, strategy: plan.strategy, segmentCount: plan.segments.length };
}

export type DigestApplyResult = {
  commitId: string;
  created: number;
  links: number;
  branch: string;
};

export async function applyDigest(
  db: SupabaseClient,
  identity: ApiIdentity,
  runId: string
): Promise<DigestApplyResult> {
  const userId = identity.userId;

  const { data: run, error: runErr } = await db
    .from("digest_runs")
    .select("id, source_memory_id, branch_id, source_title, status")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  if (runErr) throw new Error(runErr.message);
  if (!run) throw new Error("No such digest run.");
  if (run.status !== "pending") throw new Error("This digest has already been reviewed.");

  const branch = await getBranchById(db, userId, run.branch_id);
  if (!branch) throw new Error("The branch this digest was staged on no longer exists.");

  const snap = await loadMemorySnapshot(db, userId, branch, run.source_memory_id);
  if (!snap) throw new Error("The source memory no longer exists — nothing to split.");

  const { data: segs, error: segErr } = await db
    .from("digest_segments")
    .select("ordinal, new_memory_id, title, content, summary, tags")
    .eq("run_id", runId)
    .eq("user_id", userId)
    .order("ordinal", { ascending: true });
  if (segErr) throw new Error(segErr.message);
  if (!segs || segs.length < MIN_SEGMENTS) throw new Error("This digest has no segments to apply.");

  const changes: MindChange[] = [
    { memory_id: run.source_memory_id, op: "delete", title: "", content: "", summary: "", tags: [], source: snap.source },
    ...segs.map((s) => ({
      memory_id: s.new_memory_id as string,
      op: "create" as const,
      title: s.title as string,
      content: s.content as string,
      summary: s.summary as string,
      tags: (s.tags ?? []) as string[],
      source: snap.source,
    })),
  ];

  const plan = internalLinks(
    segs.map((s) => ({
      ordinal: s.ordinal as number,
      title: s.title as string,
      content: s.content as string,
      summary: s.summary as string,
      tags: (s.tags ?? []) as string[],
      reason: "",
    }))
  );
  const idByOrdinal = new Map(segs.map((s) => [s.ordinal as number, s.new_memory_id as string]));
  const linkChanges: LinkChange[] = [];
  for (const l of plan) {
    const a = idByOrdinal.get(l.a);
    const b = idByOrdinal.get(l.b);
    if (!a || !b) continue;
    const [x, y] = a < b ? [a, b] : [b, a];
    linkChanges.push({ a_id: x, b_id: y, op: "add", kind: "auto" });
  }

  const title = run.source_title || snap.title || "memory";
  const message = `digest: split "${title}" into ${segs.length} memories`;
  const commitId = await recordCommit(db, identity, branch.id, message, changes, linkChanges);

  await db
    .from("digest_runs")
    .update({ status: "applied", reviewed_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("user_id", userId);

  return { commitId, created: segs.length, links: linkChanges.length, branch: branch.name };
}
