import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import {
  avError,
  BRANCH_STATE_ENTRY_CAP,
  BRIDGE_RATE_LIMIT,
  memoryToEntries,
  type AVMemoryBranchState,
  type AVMemoryEntry,
} from "@/lib/polytician/bridge";
import { ensurePolyticianBranch, loadConceptRowsByMemory } from "@/lib/polytician/repo";
import { branchState } from "@/lib/mind/state";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest, { params }: { params: Promise<{ branch: string }> }) {
  const auth = await resolveApiIdentity(req, { keyRateLimit: BRIDGE_RATE_LIMIT });
  if ("error" in auth) return avError(auth.status, "UNAUTHORIZED", auth.error);

  const admin = createAdminClient();
  if (!admin) return avError(503, "NOT_CONFIGURED", "Server is not configured with Supabase credentials.");

  const userId = auth.identity.userId;
  const { branch: branchParam } = await params;
  const branchName = decodeURIComponent(branchParam);

  try {
    const branch = await ensurePolyticianBranch(admin, userId, branchName);
    const rows = await branchState(admin, userId, branch.id);
    const capped = rows.slice(0, BRANCH_STATE_ENTRY_CAP);
    const concepts = await loadConceptRowsByMemory(
      admin,
      userId,
      capped.map((r) => r.memory_id)
    );

    const entries: AVMemoryEntry[] = [];
    for (const row of capped) entries.push(...memoryToEntries(row, concepts.get(row.memory_id) ?? null));

    const body: AVMemoryBranchState = {
      branch: branch.name,
      headSha: branch.head_commit_id ?? "",
      entries,
    };
    return NextResponse.json(body);
  } catch (err) {
    return avError(500, "BRANCH_READ_FAILED", err instanceof Error ? err.message : "Could not read the branch.");
  }
}
