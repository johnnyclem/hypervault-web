import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { generateDigestForMemory } from "@/lib/digestion";
import { resolveBranch } from "@/lib/mind/branches";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingDigestionSchemaHint } from "@/lib/supabase/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const memoryId = typeof body.memoryId === "string" ? body.memoryId.trim() : "";
  if (!memoryId) {
    return NextResponse.json({ error: "memoryId is required — the memory to digest." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const branchName = typeof body.branch === "string" ? body.branch : null;
  const branch = await resolveBranch(admin, auth.identity.userId, branchName).catch(() => null);
  if (!branch) {
    return NextResponse.json({ error: "No such branch — create it first via /api/mind/branches." }, { status: 404 });
  }

  try {
    const summary = await generateDigestForMemory(admin, auth.identity.userId, memoryId, branch);
    return NextResponse.json({
      run_id: summary.runId,
      strategy: summary.strategy,
      segment_count: summary.segmentCount,
      message: summary.runId
        ? summary.reason ??
          `Proposed splitting this into ${summary.segmentCount} memories — review the digest.`
        : (summary.reason ?? "Nothing to split — this reads as a single memory."),
    });
  } catch (e) {
    const err = e as { code?: string; message: string };
    const hint = missingDigestionSchemaHint(err);
    return NextResponse.json(
      { error: hint ?? `Could not digest that memory: ${err.message ?? "unknown error"}` },
      { status: hint ? 503 : 500 }
    );
  }
}
