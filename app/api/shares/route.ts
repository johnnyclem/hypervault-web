import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveApiIdentity } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  artifactRefColumn,
  escapeLikePattern,
  isMissingTableError,
  PRIVACY_MIGRATION_HINT,
} from "@/lib/visibility";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function findOwnedArtifact(admin: SupabaseClient, userId: string, ref: string) {
  const { data } = await admin
    .from("artifacts")
    .select("id, slug, title")
    .eq("user_id", userId)
    .eq(artifactRefColumn(ref), ref)
    .maybeSingle();
  return data as { id: string; slug: string; title: string } | null;
}

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const ref = req.nextUrl.searchParams.get("artifact")?.trim() ?? "";
  if (!ref) return NextResponse.json({ error: "artifact is required — an id or slug." }, { status: 400 });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const artifact = await findOwnedArtifact(admin, auth.identity.userId, ref);
  if (!artifact) {
    return NextResponse.json({ error: `No artifact matching "${ref}" in your vault.` }, { status: 404 });
  }

  const { data, error } = await admin
    .from("artifact_shares")
    .select("id, created_at, shared_with:profiles!artifact_shares_shared_with_id_fkey(email, display_name)")
    .eq("artifact_id", artifact.id)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingTableError(error, "artifact_shares")) {
      return NextResponse.json({ error: PRIVACY_MIGRATION_HINT }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    shares: (data ?? []).map((s) => {
      const p = (Array.isArray(s.shared_with) ? s.shared_with[0] : s.shared_with) as {
        email: string | null;
        display_name: string | null;
      } | null;
      return {
        id: s.id,
        email: p?.email ?? null,
        display_name: p?.display_name ?? null,
        created_at: s.created_at,
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const ref = typeof body.artifact === "string" ? body.artifact.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!ref) return NextResponse.json({ error: "artifact is required — an id or slug." }, { status: 400 });
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "email must be a valid address." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const artifact = await findOwnedArtifact(admin, auth.identity.userId, ref);
  if (!artifact) {
    return NextResponse.json({ error: `No artifact matching "${ref}" in your vault.` }, { status: 404 });
  }

  const { data: targets } = await admin
    .from("profiles")
    .select("id, email, display_name")
    .ilike("email", escapeLikePattern(email))
    .limit(1);
  const target = targets?.[0];

  if (!target) {
    return NextResponse.json(
      { error: `No HyperVault account for ${email} yet — they'll need to sign up (free) before you can invite them.` },
      { status: 404 }
    );
  }
  if (target.id === auth.identity.userId) {
    return NextResponse.json({ error: "That's you — you already have access." }, { status: 400 });
  }

  const { error } = await admin
    .from("artifact_shares")
    .upsert(
      { artifact_id: artifact.id, owner_id: auth.identity.userId, shared_with_id: target.id },
      { onConflict: "artifact_id,shared_with_id", ignoreDuplicates: true }
    );

  if (error) {
    if (isMissingTableError(error, "artifact_shares")) {
      return NextResponse.json({ error: PRIVACY_MIGRATION_HINT }, { status: 503 });
    }
    return NextResponse.json({ error: `Could not share the artifact: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    shared_with: { email: target.email, display_name: target.display_name },
    message: `Invited ${target.display_name ?? target.email} — “${artifact.title}” now opens for their account too.`,
  });
}

export async function DELETE(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const shareId = typeof body.share_id === "string" ? body.share_id.trim() : "";
  if (!shareId || artifactRefColumn(shareId) !== "id") {
    return NextResponse.json({ error: "share_id is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data, error } = await admin
    .from("artifact_shares")
    .delete()
    .eq("id", shareId)
    .or(`owner_id.eq.${auth.identity.userId},shared_with_id.eq.${auth.identity.userId}`)
    .select("id");

  if (error) {
    if (isMissingTableError(error, "artifact_shares")) {
      return NextResponse.json({ error: PRIVACY_MIGRATION_HINT }, { status: 503 });
    }
    return NextResponse.json({ error: `Could not remove the share: ${error.message}` }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "No such share (or it isn't yours to remove)." }, { status: 404 });
  }

  return NextResponse.json({ message: "Access removed." });
}
