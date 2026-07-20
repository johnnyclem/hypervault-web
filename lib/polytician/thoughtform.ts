import { createHash } from "crypto";
import { contentHash } from "@/lib/hash";
import { autoTags, autoTitle, summarize } from "@/lib/memory";


export type EntityV1 = {
  id: string;
  type: string;
  value: string;
  confidence?: number;
  [k: string]: unknown;
};

export type RelationshipV1 = {
  id: string;
  type: string;
  from: string;
  to: string;
  weight?: number;
  [k: string]: unknown;
};

export type ThoughtMetadataV1 = {
  createdAtMs: number;
  updatedAtMs: number;
  source: string;
  contentHash: string;
  tombstone?: boolean;
  [k: string]: unknown;
};

export type ThoughtFormV1 = {
  schemaVersion: string;
  id: string;
  metadata: ThoughtMetadataV1;
  content?: string;
  entities: EntityV1[];
  relationships: RelationshipV1[];
  context: Record<string, unknown>;
  extensions: Record<string, unknown>;
  [k: string]: unknown;
};

const THOUGHTFORM_VERSION = "1.0";

export function isThoughtFormV1(x: unknown): x is ThoughtFormV1 {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.schemaVersion === "string" && Array.isArray(o.entities) && Array.isArray(o.relationships);
}

function entityId(kind: string, value: string): string {
  return createHash("sha256").update(`${kind}:${value}`).digest("hex").slice(0, 16);
}

export type MemoryForThoughtForm = {
  id: string;
  title: string;
  content: string;
  summary: string;
  tags: string[] | null;
};

export function memoryToThoughtForm(
  memory: MemoryForThoughtForm,
  linkedTitles: string[] = [],
  opts: { createdAtMs?: number; updatedAtMs?: number } = {}
): ThoughtFormV1 {
  const now = opts.updatedAtMs ?? opts.createdAtMs ?? 0;
  const selfId = entityId("memory", memory.title || memory.id);
  const entities: EntityV1[] = [
    { id: selfId, type: "memory", value: memory.title || "Untitled memory" },
    ...(memory.tags ?? []).map((t) => ({ id: entityId("tag", t), type: "tag", value: t })),
    ...linkedTitles.map((t) => ({ id: entityId("memory", t), type: "memory", value: t })),
  ];
  const relationships: RelationshipV1[] = linkedTitles.map((t) => ({
    id: entityId("rel", `${memory.title}->${t}`),
    type: "related_to",
    from: selfId,
    to: entityId("memory", t),
  }));

  return {
    schemaVersion: THOUGHTFORM_VERSION,
    id: memory.id,
    metadata: {
      createdAtMs: opts.createdAtMs ?? now,
      updatedAtMs: now,
      source: "hypervault",
      contentHash: contentHash(memory.content),
    },
    content: memory.content,
    entities,
    relationships,
    context: { summary: memory.summary },
    extensions: {},
  };
}

export type MemoryDraft = {
  title: string;
  content: string;
  tags: string[];
  summary: string;
};

export function thoughtFormToMemory(tf: ThoughtFormV1): MemoryDraft {
  const content = typeof tf.content === "string" && tf.content.trim() ? tf.content : renderThoughtForm(tf);
  const title = autoTitle(content);
  const tagEntities = tf.entities.filter((e) => e.type === "tag").map((e) => e.value);
  const tags = [...new Set([...tagEntities, ...autoTags(content, title)])].slice(0, 12);
  return { title, content, tags, summary: summarize(content) };
}

function renderThoughtForm(tf: ThoughtFormV1): string {
  const lines: string[] = [];
  const named = tf.entities.filter((e) => e.type !== "tag");
  if (named.length) {
    lines.push("## Entities");
    for (const e of named) lines.push(`- **${e.value}** (${e.type})`);
  }
  if (tf.relationships.length) {
    lines.push("", "## Relationships");
    const byId = new Map(tf.entities.map((e) => [e.id, e.value]));
    for (const r of tf.relationships) {
      lines.push(`- ${byId.get(r.from) ?? r.from} — ${r.type} → ${byId.get(r.to) ?? r.to}`);
    }
  }
  return lines.join("\n") || "Untitled concept";
}
