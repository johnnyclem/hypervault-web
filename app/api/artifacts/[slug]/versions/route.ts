import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { listArtifactVersions } from "@/lib/artifacts/versions";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingColumnError } from "@/lib/visibility";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { slug } = await params;

  const withMutable = await admin
    .from("artifacts")
    .select("id, title, mutable")
    .eq("user_id", auth.identity.userId)
    .eq("slug", slug)
    .maybeSingle();
  let artifact = withMutable.data as { id: string; title: string; mutable?: boolean } | null;
  if (withMutable.error) {
    if (!isMissingColumnError(withMutable.error, "mutable")) {
      return NextResponse.json({ error: withMutable.error.message }, { status: 500 });
    }
    const legacy = await admin
      .from("artifacts")
      .select("id, title")
      .eq("user_id", auth.identity.userId)
      .eq("slug", slug)
      .maybeSingle();
    if (legacy.error) return NextResponse.json({ error: legacy.error.message }, { status: 500 });
    artifact = legacy.data as { id: string; title: string } | null;
  }
  if (!artifact) return NextResponse.json({ error: "No artifact matching that link in your vault." }, { status: 404 });

  const full = req.nextUrl.searchParams.get("full") === "1" || req.nextUrl.searchParams.get("full") === "true";
  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 100;

  const versions = await listArtifactVersions(admin, artifact.id, { full, limit });

  const keyIds = [...new Set(versions.map((v) => v.author_key_id).filter((id): id is string => Boolean(id)))];
  const prefixes = new Map<string, string>();
  if (keyIds.length > 0) {
    const { data: keys } = await admin.from("api_keys").select("id, key_prefix").in("id", keyIds);
    for (const k of keys ?? []) prefixes.set(k.id as string, k.key_prefix as string);
  }

  return NextResponse.json({
    slug,
    mutable: artifact.mutable ?? false,
    versions: versions.map((v) => ({
      id: v.id,
      parent_version_id: v.parent_version_id,
      title: v.title,
      message: v.message,
      author_kind: v.author_kind,
      author_key_prefix: v.author_key_id ? prefixes.get(v.author_key_id) ?? null : null,
      content_hash: v.content_hash,
      is_jsx: v.is_jsx,
      is_head: v.is_head,
      created_at: v.created_at,
      ...(full ? { content: v.content, original_content: v.original_content } : {}),
    })),
  });
}
