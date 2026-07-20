import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { artifactRefColumn, isMissingColumnError } from "@/lib/visibility";


async function loadOwnArtifact(userId: string, ref: string) {
  const admin = createAdminClient();
  if (!admin) return { error: "Server is not configured with Supabase credentials.", status: 503 as const };

  const column = artifactRefColumn(ref);
  let res = await admin
    .from("artifacts")
    .select("id, feedback")
    .eq("user_id", userId)
    .eq(column, ref)
    .maybeSingle();
  if (res.error && isMissingColumnError(res.error, "feedback")) {
    res = await admin.from("artifacts").select("id").eq("user_id", userId).eq(column, ref).maybeSingle();
  }
  if (res.error) return { error: res.error.message, status: 500 as const };
  if (!res.data) return { error: "Artifact not found.", status: 404 as const };
  return { admin, artifact: res.data as { id: string; feedback?: number | null } };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { slug } = await params;
  const loaded = await loadOwnArtifact(auth.identity.userId, slug);
  if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status });

  const value = loaded.artifact.feedback;
  return NextResponse.json(
    { feedback: value === 1 ? "up" : value === -1 ? "down" : null },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const feedback = body.feedback ?? null;
  if (feedback !== "up" && feedback !== "down" && feedback !== null) {
    return NextResponse.json({ error: 'feedback must be "up", "down", or null.' }, { status: 400 });
  }
  const value = feedback === "up" ? 1 : feedback === "down" ? -1 : null;

  const { slug } = await params;
  const loaded = await loadOwnArtifact(auth.identity.userId, slug);
  if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status });

  const { error } = await loaded.admin
    .from("artifacts")
    .update({ feedback: value })
    .eq("id", loaded.artifact.id);
  if (error) {
    if (isMissingColumnError(error, "feedback")) {
      return NextResponse.json(
        { error: "Artifact ratings aren't enabled on this server yet — apply migration 0017_artifact_feedback." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    slug,
    feedback,
    message: feedback === null ? "Rating cleared." : "Rating saved.",
  });
}
