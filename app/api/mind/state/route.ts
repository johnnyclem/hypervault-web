import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { getBranchByName } from "@/lib/mind/branches";
import { resolveRef } from "@/lib/mind/refs";
import { linksAt, stateAt } from "@/lib/mind/state";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }
  const userId = auth.identity.userId;

  const at = (req.nextUrl.searchParams.get("at") ?? "").trim();
  if (!at) {
    return NextResponse.json({ error: "Pass at — a commit id, branch name, or timestamp." }, { status: 400 });
  }

  try {
    const branchHintName = req.nextUrl.searchParams.get("branch");
    const branchHint = branchHintName ? (await getBranchByName(admin, userId, branchHintName)) ?? undefined : undefined;
    const ref = await resolveRef(admin, userId, at, { branchHint });
    if (!ref) return NextResponse.json({ error: `Could not resolve "${at}" to a commit.` }, { status: 404 });

    const [rows, links] = await Promise.all([
      stateAt(admin, userId, ref.commitId),
      linksAt(admin, userId, ref.commitId),
    ]);

    rows.sort((x, y) => (y.committed_at < x.committed_at ? -1 : 1));
    return NextResponse.json({
      at,
      commit_id: ref.commitId,
      memories: rows.map((r) => ({
        id: r.memory_id,
        title: r.title,
        summary: r.summary,
        tags: r.tags,
        source: r.source,
        committed_at: r.committed_at,
      })),
      links,
      message: `Your mind held ${rows.length} memor${rows.length === 1 ? "y" : "ies"} and ${links.length} link${links.length === 1 ? "" : "s"} at that point.`,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Time-travel failed." }, { status: 500 });
  }
}
