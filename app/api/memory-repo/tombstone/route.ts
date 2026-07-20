import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { recordCommit } from "@/lib/mind/commits";
import { headSnapshot } from "@/lib/mind/state";
import {
  avError,
  BRIDGE_RATE_LIMIT,
  conceptIdToMemoryId,
  parseConceptKey,
} from "@/lib/polytician/bridge";
import { clearConceptThoughtform, deleteConcept, ensurePolyticianBranch, getConceptById } from "@/lib/polytician/repo";
import { createAdminClient } from "@/lib/supabase/admin";

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
  const key = typeof body.key === "string" ? body.key : "";
  if (!branchName) return avError(400, "BAD_REQUEST", "branch is required.");
  const parsed = parseConceptKey(key);
  if (!parsed) return avError(400, "BAD_KEY", `Unrecognized key: ${key || "(missing)"}`);

  const admin = createAdminClient();
  if (!admin) return avError(503, "NOT_CONFIGURED", "Server is not configured with Supabase credentials.");

  const userId = auth.identity.userId;
  const { conceptId, representation } = parsed;

  try {
    const branch = await ensurePolyticianBranch(admin, userId, branchName);
    const memoryId = conceptIdToMemoryId(conceptId);

    if (representation === "markdown") {
      const existing = await headSnapshot(admin, userId, branch.id, memoryId);
      if (existing) {
        await recordCommit(
          admin,
          auth.identity,
          branch.id,
          `polytician: tombstone ${conceptId}`,
          [
            {
              memory_id: memoryId,
              op: "delete",
              title: existing.title,
              content: existing.content,
              summary: existing.summary,
              tags: existing.tags,
              source: existing.source,
            },
          ]
        );
      }
      const concept = await getConceptById(admin, userId, conceptId);
      if (concept && concept.thoughtform == null) await deleteConcept(admin, userId, conceptId);
    } else {
      await clearConceptThoughtform(admin, userId, conceptId);
      const stillThere = await headSnapshot(admin, userId, branch.id, memoryId);
      if (!stillThere) await deleteConcept(admin, userId, conceptId);
    }

    return NextResponse.json({ success: true, branch: branch.name, key });
  } catch (err) {
    return avError(500, "TOMBSTONE_FAILED", err instanceof Error ? err.message : "Could not tombstone the concept.");
  }
}
