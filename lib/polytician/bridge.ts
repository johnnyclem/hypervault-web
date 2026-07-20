import { createHash } from "crypto";
import { NextResponse } from "next/server";
import type { StateRow } from "@/lib/mind/state";


export type AVRepresentation = "markdown" | "thoughtform";

export type AVMemoryEntry = {
  key: string;
  contentType: "markdown" | "json";
  data: string;
  tags: string[];
  metadata: {
    conceptId: string;
    namespace: string;
    version: number;
    updatedAt: number;
  };
};

export type AVMemoryBranchState = {
  branch: string;
  headSha: string;
  entries: AVMemoryEntry[];
};

export type AVMemoryCommit = {
  sha: string;
  branch: string;
  author: string;
  timestamp: number;
  message: string;
  entries: AVMemoryEntry[];
};

export type AVErrorResponse = {
  error: string;
  code: string;
  details?: unknown;
};

export const POLYTICIAN_DEFAULT_BRANCH = "polytician-main";

export const BRIDGE_RATE_LIMIT = 240;

export const BRANCH_STATE_ENTRY_CAP = 1000;

export const MAX_COMMIT_ENTRIES = 100;
export const MAX_ENTRY_BYTES = 500_000;

const CONCEPT_KEY_RE = /^concepts\/([^/]+)\/(markdown|thoughtform)$/;

export function parseConceptKey(
  key: string
): { conceptId: string; representation: AVRepresentation } | null {
  const m = key.match(CONCEPT_KEY_RE);
  if (!m) return null;
  return { conceptId: m[1], representation: m[2] as AVRepresentation };
}

export function buildConceptKey(conceptId: string, representation: AVRepresentation): string {
  return `concepts/${conceptId}/${representation}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function conceptIdToMemoryId(conceptId: string): string {
  if (UUID_RE.test(conceptId)) return conceptId.toLowerCase();
  const h = createHash("sha256").update(conceptId, "utf8").digest("hex");
  const b = h.slice(0, 32).split("");
  b[12] = "5";
  b[16] = ((parseInt(b[16], 16) & 0x3) | 0x8).toString(16);
  const s = b.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

export type PolyticianConceptRow = {
  memory_id: string;
  concept_id: string;
  namespace: string;
  version: number;
  thoughtform: unknown | null;
  updated_at_ms: number | null;
};

export function memoryToEntries(row: StateRow, concept: PolyticianConceptRow | null): AVMemoryEntry[] {
  const conceptId = concept?.concept_id ?? row.memory_id;
  const namespace = concept?.namespace ?? "default";
  const version = concept?.version ?? 1;
  const updatedAt = concept?.updated_at_ms ?? (Date.parse(row.committed_at) || 0);
  const tags = row.tags ?? [];
  const baseMeta = { conceptId, namespace, version, updatedAt };

  const entries: AVMemoryEntry[] = [
    {
      key: buildConceptKey(conceptId, "markdown"),
      contentType: "markdown",
      data: row.content,
      tags,
      metadata: baseMeta,
    },
  ];
  if (concept?.thoughtform != null) {
    entries.push({
      key: buildConceptKey(conceptId, "thoughtform"),
      contentType: "json",
      data: JSON.stringify(concept.thoughtform),
      tags,
      metadata: baseMeta,
    });
  }
  return entries;
}

export function avError(status: number, code: string, message: string, details?: unknown): NextResponse {
  const body: AVErrorResponse = { error: message, code };
  if (details !== undefined) body.details = details;
  return NextResponse.json(body, { status });
}
