import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { autoTags, autoTitle, summarize } from "@/lib/memory";
import { recordCommit } from "@/lib/mind/commits";
import { headSnapshot } from "@/lib/mind/state";
import type { MindChange } from "@/lib/mind/types";
import {
  avError,
  BRIDGE_RATE_LIMIT,
  conceptIdToMemoryId,
  MAX_COMMIT_ENTRIES,
  MAX_ENTRY_BYTES,
  memoryToEntries,
  parseConceptKey,
  type AVMemoryCommit,
  type AVMemoryEntry,
} from "@/lib/polytician/bridge";
import { ensurePolyticianBranch, upsertConcept } from "@/lib/polytician/repo";
import { createAdminClient } from "@/lib/supabase/admin";

type ConceptGroup = {
  conceptId: string;
  markdown?: AVMemoryEntry;
  thoughtform?: AVMemoryEntry;
};

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req, { keyRateLimit: BRIDGE_RATE_LIMIT });
  if ("error" in auth) return avError(auth.status, "UNAUTHORIZED", auth.error);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return avError(400, "BAD_REQUEST", "Body must be JSON.");
  }

  const branchName = typeof body.branch === "string" && body.branch.trim() ? body.branch.trim() : null;
  if (!branchName) return avError(400, "BAD_REQUEST", "branch is required.");
  const rawEntries = Array.isArray(body.entries) ? (body.entries as AVMemoryEntry[]) : null;
  if (!rawEntries) return avError(400, "BAD_REQUEST", "entries[] is required.");
  if (rawEntries.length > MAX_COMMIT_ENTRIES) {
    return avError(413, "TOO_MANY_ENTRIES", `At most ${MAX_COMMIT_ENTRIES} entries per commit.`);
  }

  const groups = new Map<string, ConceptGroup>();
  for (const entry of rawEntries) {
    const parsed = entry?.key ? parseConceptKey(entry.key) : null;
    if (!parsed) return avError(400, "BAD_KEY", `Unrecognized entry key: ${entry?.key ?? "(missing)"}`);
    const data = typeof entry.data === "string" ? entry.data : "";
    if (new TextEncoder().encode(data).length > MAX_ENTRY_BYTES) {
      return avError(413, "ENTRY_TOO_LARGE", `Entry ${entry.key} exceeds the ${MAX_ENTRY_BYTES}-byte limit.`);
    }
    const group = groups.get(parsed.conceptId) ?? { conceptId: parsed.conceptId };
    group[parsed.representation] = entry;
    groups.set(parsed.conceptId, group);
  }
  if (groups.size === 0) return avError(400, "BAD_REQUEST", "No valid concept entries.");

  const admin = createAdminClient();
  if (!admin) return avError(503, "NOT_CONFIGURED", "Server is not configured with Supabase credentials.");

  const userId = auth.identity.userId;
  const message =
    typeof body.message === "string" && body.message.trim()
      ? body.message.trim()
      : `polytician: sync ${groups.size} concept${groups.size === 1 ? "" : "s"}`;

  try {
    const branch = await ensurePolyticianBranch(admin, userId, branchName);

    const changes: MindChange[] = [];
    const conceptWrites: {
      memoryId: string;
      conceptId: string;
      namespace: string;
      version: number;
      updatedAtMs: number;
      thoughtform?: unknown;
    }[] = [];

    for (const group of groups.values()) {
      const memoryId = conceptIdToMemoryId(group.conceptId);
      const meta = group.markdown?.metadata ?? group.thoughtform?.metadata;
      const namespace = meta?.namespace ?? "default";
      const version = meta?.version ?? 1;
      const updatedAtMs = meta?.updatedAt ?? Date.now();

      let thoughtform: unknown | undefined;
      if (group.thoughtform) {
        try {
          thoughtform = JSON.parse(group.thoughtform.data);
        } catch {
          return avError(400, "BAD_THOUGHTFORM", `Entry ${group.thoughtform.key} is not valid JSON.`);
        }
      }

      if (group.markdown) {
        const content = group.markdown.data;
        const existing = await headSnapshot(admin, userId, branch.id, memoryId);
        const title = autoTitle(content);
        const tags = [...new Set([...(group.markdown.tags ?? []), ...autoTags(content, title)])].slice(0, 12);
        changes.push({
          memory_id: memoryId,
          op: existing ? "update" : "create",
          title,
          content,
          summary: summarize(content),
          tags,
          source: "agent",
        });
      }

      conceptWrites.push({ memoryId, conceptId: group.conceptId, namespace, version, updatedAtMs, thoughtform });
    }

    let sha = branch.head_commit_id ?? "";
    if (changes.length > 0) {
      sha = await recordCommit(admin, auth.identity, branch.id, message, changes);
    }

    for (const w of conceptWrites) {
      await upsertConcept(admin, userId, w);
    }

    const echoed: AVMemoryEntry[] = [];
    for (const group of groups.values()) {
      const memoryId = conceptIdToMemoryId(group.conceptId);
      const snap = await headSnapshot(admin, userId, branch.id, memoryId);
      if (!snap) continue;
      const w = conceptWrites.find((c) => c.conceptId === group.conceptId)!;
      echoed.push(
        ...memoryToEntries(snap, {
          memory_id: memoryId,
          concept_id: group.conceptId,
          namespace: w.namespace,
          version: w.version,
          thoughtform: w.thoughtform ?? null,
          updated_at_ms: w.updatedAtMs,
        })
      );
    }

    const author =
      auth.identity.via === "api-key" && auth.identity.keyId ? "hypervault-agent" : "hypervault-user";

    const receipt: AVMemoryCommit = {
      sha,
      branch: branch.name,
      author,
      timestamp: Date.now(),
      message,
      entries: echoed,
    };
    return NextResponse.json(receipt);
  } catch (err) {
    return avError(500, "COMMIT_FAILED", err instanceof Error ? err.message : "Could not record the commit.");
  }
}
