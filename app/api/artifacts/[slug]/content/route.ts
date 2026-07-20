import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import {
  headVersion,
  MUTABLE_MIGRATION_HINT,
  preprocessArtifactContent,
  recordArtifactVersion,
} from "@/lib/artifacts/versions";
import { contentHash } from "@/lib/hash";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/utils";
import { isMissingColumnError } from "@/lib/visibility";

const MAX_CONTENT_BYTES = 1_000_000;

type ArtifactRow = {
  id: string;
  slug: string;
  title: string;
  type: string;
  content: string;
  original_content: string | null;
  content_hash: string | null;
  source_prompt: string | null;
  is_jsx: boolean;
  mutable: boolean;
};

async function loadOwnedArtifact(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  slug: string
): Promise<{ artifact: ArtifactRow | null; error: string | null }> {
  const columns = "id, slug, title, type, content, original_content, content_hash, source_prompt, is_jsx";
  const withMutable = await admin!
    .from("artifacts")
    .select(`${columns}, mutable`)
    .eq("user_id", userId)
    .eq("slug", slug)
    .maybeSingle();

  if (!withMutable.error) {
    return { artifact: (withMutable.data as ArtifactRow) ?? null, error: null };
  }
  if (!isMissingColumnError(withMutable.error, "mutable")) {
    return { artifact: null, error: withMutable.error.message };
  }
  const legacy = await admin!
    .from("artifacts")
    .select(columns)
    .eq("user_id", userId)
    .eq("slug", slug)
    .maybeSingle();
  if (legacy.error) return { artifact: null, error: legacy.error.message };
  const row = legacy.data as Omit<ArtifactRow, "mutable"> | null;
  return { artifact: row ? { ...row, mutable: false } : null, error: null };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { slug } = await params;
  const { artifact, error } = await loadOwnedArtifact(admin, auth.identity.userId, slug);
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!artifact) return NextResponse.json({ error: "No artifact matching that link in your vault." }, { status: 404 });

  const versionId = req.nextUrl.searchParams.get("version")?.trim();
  if (versionId) {
    const { data: version, error: vErr } = await admin
      .from("artifact_versions")
      .select("id, title, content, original_content, content_hash, message, is_jsx, created_at")
      .eq("artifact_id", artifact.id)
      .eq("id", versionId)
      .maybeSingle();
    if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
    if (!version) {
      return NextResponse.json({ error: `No version ${versionId} for this artifact.` }, { status: 404 });
    }
    const source =
      version.is_jsx && version.original_content ? version.original_content : version.content;
    return NextResponse.json({
      slug: artifact.slug,
      title: version.title,
      content: source,
      is_jsx: version.is_jsx,
      mutable: artifact.mutable,
      content_hash: version.content_hash,
      version: { id: version.id, message: version.message, created_at: version.created_at, is_head: false },
    });
  }

  const source =
    artifact.is_jsx && artifact.original_content ? artifact.original_content : artifact.content;
  const head = await headVersion(admin, artifact.id).catch(() => null);
  return NextResponse.json({
    slug: artifact.slug,
    title: artifact.title,
    content: source,
    is_jsx: artifact.is_jsx,
    mutable: artifact.mutable,
    content_hash: artifact.content_hash,
    version: head
      ? { id: head.id, message: head.message, created_at: head.created_at, is_head: true }
      : null,
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) {
    return NextResponse.json({ error: "content is required — the new HTML or JSX to write." }, { status: 400 });
  }
  if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
    return NextResponse.json(
      { error: "Artifact is over the 1 MB limit. Trim embedded assets and try again." },
      { status: 413 }
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { slug } = await params;
  const { artifact, error } = await loadOwnedArtifact(admin, auth.identity.userId, slug);
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!artifact) return NextResponse.json({ error: "No artifact matching that link in your vault." }, { status: 404 });

  if (!artifact.mutable) {
    return NextResponse.json(
      {
        error:
          `“${artifact.title}” is immutable, so it can't be rewritten — that's the default for artifacts. ` +
          `Save a new one with mutable:true (via /api/save) to get a living document you can write to.`,
      },
      { status: 409 }
    );
  }

  const forceHtml = body.force_html === true;
  const title = (typeof body.title === "string" && body.title.trim()) || artifact.title;
  const message = (typeof body.message === "string" && body.message.trim()) || "edit";

  const prepared = preprocessArtifactContent({
    content,
    title,
    type: artifact.type,
    forceHtml,
    sourcePrompt: artifact.source_prompt,
  });
  const hash = contentHash(content);

  if (artifact.content_hash && hash === artifact.content_hash && title === artifact.title) {
    const head = await headVersion(admin, artifact.id).catch(() => null);
    return NextResponse.json({
      url: `${appUrl()}/a/${artifact.slug}`,
      slug: artifact.slug,
      unchanged: true,
      version: head ? { id: head.id, message: head.message, created_at: head.created_at } : null,
      message: "No change — the new content matches the current version, so no commit was recorded.",
    });
  }

  const { error: updateError } = await admin
    .from("artifacts")
    .update({
      title,
      type: prepared.type,
      content: prepared.storedContent,
      original_content: prepared.originalContent,
      content_hash: hash,
      is_jsx: prepared.isJsx,
      updated_at: new Date().toISOString(),
    })
    .eq("id", artifact.id)
    .eq("user_id", auth.identity.userId);
  if (updateError) {
    return NextResponse.json({ error: `Could not write the artifact: ${updateError.message}` }, { status: 500 });
  }

  let version = null;
  try {
    version = await recordArtifactVersion(admin, {
      artifactId: artifact.id,
      userId: auth.identity.userId,
      title,
      storedContent: prepared.storedContent,
      originalContent: prepared.originalContent,
      contentHash: hash,
      message,
      authorKind: auth.identity.via === "api-key" ? "agent" : "user",
      authorKeyId: auth.identity.via === "api-key" ? auth.identity.keyId ?? null : null,
      isJsx: prepared.isJsx,
    });
  } catch {
  }

  return NextResponse.json({
    url: `${appUrl()}/a/${artifact.slug}`,
    slug: artifact.slug,
    is_jsx: prepared.isJsx,
    unchanged: false,
    version: version
      ? { id: version.id, message: version.message, created_at: version.created_at }
      : null,
    message: version
      ? `Wrote a new version of “${title}”. Its history now has this commit${
          prepared.isJsx ? " (React/JSX detected and re-wrapped)" : ""
        }.`
      : `Updated “${title}”. ${MUTABLE_MIGRATION_HINT}`,
  });
}
