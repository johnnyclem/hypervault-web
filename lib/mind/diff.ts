import { structuredPatch } from "diff";
import type { LinkState, MemorySnapshot, MemoryState } from "@/lib/mind/types";
import { splitLinkKey } from "@/lib/mind/types";


const MAX_DIFF_CHARS = 400_000;

export type DiffLine = { kind: "add" | "del" | "ctx"; text: string };

export type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
};

export type TextDiff = {
  hunks: DiffHunk[];
  oversize: boolean;
};

export function diffMemoryText(from: string, to: string): TextDiff {
  if (from === to) return { hunks: [], oversize: false };
  if (from.length + to.length > MAX_DIFF_CHARS) return { hunks: [], oversize: true };

  const patch = structuredPatch("memory", "memory", from, to, undefined, undefined, { context: 2 });
  return {
    oversize: false,
    hunks: patch.hunks.map((h) => ({
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      lines: h.lines.map((line): DiffLine => {
        if (line.startsWith("+")) return { kind: "add", text: line.slice(1) };
        if (line.startsWith("-")) return { kind: "del", text: line.slice(1) };
        return { kind: "ctx", text: line.slice(1) };
      }),
    })),
  };
}

export type MemoryDiff = {
  memory_id: string;
  title_from: string;
  title_to: string;
  tags_added: string[];
  tags_removed: string[];
  content_changed: boolean;
  diff: TextDiff;
};

export type StateDiff = {
  added: MemorySnapshot[];
  removed: MemorySnapshot[];
  changed: MemoryDiff[];
};

export function diffStates(from: MemoryState, to: MemoryState): StateDiff {
  const added: MemorySnapshot[] = [];
  const removed: MemorySnapshot[] = [];
  const changed: MemoryDiff[] = [];

  for (const [id, snapshot] of to) {
    const before = from.get(id);
    if (!before) {
      added.push(snapshot);
      continue;
    }
    const tagsBefore = new Set(before.tags);
    const tagsAfter = new Set(snapshot.tags);
    const tagsAdded = snapshot.tags.filter((t) => !tagsBefore.has(t));
    const tagsRemoved = before.tags.filter((t) => !tagsAfter.has(t));
    const contentChanged = before.content !== snapshot.content;
    if (before.title === snapshot.title && !contentChanged && tagsAdded.length === 0 && tagsRemoved.length === 0) {
      continue;
    }
    changed.push({
      memory_id: id,
      title_from: before.title,
      title_to: snapshot.title,
      tags_added: tagsAdded,
      tags_removed: tagsRemoved,
      content_changed: contentChanged,
      diff: contentChanged ? diffMemoryText(before.content, snapshot.content) : { hunks: [], oversize: false },
    });
  }

  for (const [id, snapshot] of from) {
    if (!to.has(id)) removed.push(snapshot);
  }

  return { added, removed, changed };
}

export type LinkRef = { a_id: string; b_id: string; kind: "manual" | "auto" };

export type LinksDiff = { added: LinkRef[]; removed: LinkRef[] };

export function diffLinks(from: LinkState, to: LinkState): LinksDiff {
  const added: LinkRef[] = [];
  const removed: LinkRef[] = [];
  for (const [key, kind] of to) {
    if (!from.has(key)) added.push({ ...splitLinkKey(key), kind });
  }
  for (const [key, kind] of from) {
    if (!to.has(key)) removed.push({ ...splitLinkKey(key), kind });
  }
  return { added, removed };
}
