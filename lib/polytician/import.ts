import { autoTitle } from "@/lib/memory";
import { isThoughtFormV1, thoughtFormToMemory, type ThoughtFormV1 } from "@/lib/polytician/thoughtform";


export type ParsedPolyticianConcept = {
  conceptId?: string;
  namespace: string;
  version: number;
  content: string;
  title: string;
  tags: string[];
  thoughtform?: ThoughtFormV1;
  updatedAtMs?: number;
};

type RawConcept = Record<string, unknown>;

function conceptArray(data: unknown): RawConcept[] | null {
  if (Array.isArray(data)) return data.filter((c) => c && typeof c === "object") as RawConcept[];
  if (data && typeof data === "object") {
    const concepts = (data as Record<string, unknown>).concepts;
    if (Array.isArray(concepts)) return concepts.filter((c) => c && typeof c === "object") as RawConcept[];
  }
  return null;
}

function hasConceptMarkers(c: RawConcept): boolean {
  return (
    "representations" in c ||
    "thoughtform" in c ||
    "thoughtForm" in c ||
    "markdown" in c ||
    "md" in c ||
    isThoughtFormV1(c)
  );
}

export function looksLikePolyticianExport(data: unknown): boolean {
  const arr = conceptArray(data);
  if (!arr || arr.length === 0) return false;
  return arr.some(hasConceptMarkers);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function parseConcept(raw: RawConcept): ParsedPolyticianConcept | null {
  if (isThoughtFormV1(raw)) {
    const draft = thoughtFormToMemory(raw);
    return {
      conceptId: str(raw.id),
      namespace: "default",
      version: 1,
      content: draft.content,
      title: draft.title,
      tags: draft.tags,
      thoughtform: raw,
      updatedAtMs: typeof raw.metadata?.updatedAtMs === "number" ? raw.metadata.updatedAtMs : undefined,
    };
  }

  const reps = (raw.representations ?? {}) as Record<string, unknown>;
  const tfRaw = raw.thoughtform ?? raw.thoughtForm ?? reps.thoughtform ?? reps.thoughtForm;
  const thoughtform = isThoughtFormV1(tfRaw) ? tfRaw : undefined;
  const markdown = str(raw.markdown) ?? str(raw.md) ?? str(raw.text) ?? str(reps.markdown) ?? str(reps.md);

  let content = markdown;
  let title = str(raw.title);
  let tags = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [];

  if (!content && thoughtform) {
    const draft = thoughtFormToMemory(thoughtform);
    content = draft.content;
    title = title ?? draft.title;
    tags = tags.length ? tags : draft.tags;
  }
  if (!content) return null;

  const conceptClock = typeof (raw.updatedAt ?? raw.updatedAtMs) === "number"
    ? ((raw.updatedAt ?? raw.updatedAtMs) as number)
    : undefined;
  const tfClock = typeof thoughtform?.metadata?.updatedAtMs === "number" ? thoughtform.metadata.updatedAtMs : undefined;

  return {
    conceptId: str(raw.id),
    namespace: str(raw.namespace) ?? "default",
    version: typeof raw.version === "number" ? raw.version : 1,
    content,
    title: title ?? autoTitle(content),
    tags,
    thoughtform,
    updatedAtMs: conceptClock ?? tfClock,
  };
}

export function parsePolyticianExport(data: unknown): ParsedPolyticianConcept[] {
  const arr = conceptArray(data);
  if (!arr) return [];
  const out: ParsedPolyticianConcept[] = [];
  for (const raw of arr) {
    const parsed = parseConcept(raw);
    if (parsed) out.push(parsed);
  }
  return out;
}
