import type { SupabaseClient } from "@supabase/supabase-js";
import { recordArtifactVersion } from "@/lib/artifacts/versions";
import { syncConnectionsForArtifact } from "@/lib/connections";
import { contentHash } from "@/lib/hash";
import { syncMemoryLinksForArtifact } from "@/lib/memory";
import { makeSlug } from "@/lib/slug";
import { appUrl } from "@/lib/utils";
import { isMissingColumnError } from "@/lib/visibility";


export async function realmOrigin(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data: claim } = await admin
    .from("domain_claims")
    .select("subdomain, base_domain")
    .eq("user_id", userId)
    .order("claimed_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (claim) return `https://${claim.subdomain}.${claim.base_domain}`;

  const { data: profile } = await admin
    .from("profiles")
    .select("vanity_subdomain")
    .eq("id", userId)
    .maybeSingle();
  return profile?.vanity_subdomain ? `https://${profile.vanity_subdomain}.vault.cool` : null;
}

export async function linkOrigin(admin: SupabaseClient, userId: string, visibility: string): Promise<string> {
  if (visibility === "private") return appUrl();
  return (await realmOrigin(admin, userId)) ?? appUrl();
}

export type SaveArtifactParams = {
  storedContent: string;
  hashContent?: string;
  title: string;
  type: string;
  tags?: string[];
  connectTo?: string[];
  originalContent?: string | null;
  sourcePrompt?: string | null;
  isPwa?: boolean;
  isJsx?: boolean;
  visibility: string;
  mutable?: boolean;
  authorKind?: "user" | "agent" | "system";
  authorKeyId?: string | null;
};

export type SavedArtifact = {
  slug: string;
  url: string;
  visibility: string;
  isJsx: boolean;
  isPwa: boolean;
  duplicate: boolean;
  existing?: { title: string; visibility: string };
  id?: string;
  connections?: { manual: number; auto: number };
  mutable?: boolean;
};

export async function saveArtifactCore(
  admin: SupabaseClient,
  userId: string,
  params: SaveArtifactParams
): Promise<SavedArtifact | { error: string; status: number }> {
  const {
    storedContent,
    hashContent = storedContent,
    title,
    type,
    tags = [],
    connectTo = [],
    originalContent = null,
    sourcePrompt = null,
    isPwa = true,
    isJsx = false,
    visibility,
    mutable = false,
    authorKind = "user",
    authorKeyId = null,
  } = params;

  const hash = contentHash(hashContent);
  const findDupe = (columns: string) =>
    admin
      .from("artifacts")
      .select(columns)
      .eq("user_id", userId)
      .eq("content_hash", hash)
      .order("created_at", { ascending: true })
      .limit(1);
  let dupeRes = mutable
    ? { data: null, error: null }
    : await findDupe("slug, title, is_pwa, is_jsx, visibility");
  if (dupeRes.error && isMissingColumnError(dupeRes.error, "visibility")) {
    dupeRes = await findDupe("slug, title, is_pwa, is_jsx");
  }
  const existing = dupeRes.data?.[0] as
    | { slug: string; title: string; is_pwa: boolean; is_jsx: boolean; visibility?: string | null }
    | undefined;
  if (existing) {
    const existingVisibility = existing.visibility ?? "public";
    const url = `${await linkOrigin(admin, userId, existingVisibility)}/a/${existing.slug}`;
    return {
      slug: existing.slug,
      url,
      visibility: existingVisibility,
      isJsx: existing.is_jsx,
      isPwa: existing.is_pwa,
      duplicate: true,
      existing: { title: existing.title, visibility: existingVisibility },
    };
  }

  const slug = makeSlug(title);
  const payload: Record<string, unknown> = {
    user_id: userId,
    slug,
    title,
    type,
    tags,
    connect_to: connectTo,
    content: storedContent,
    original_content: originalContent,
    content_hash: hash,
    source_prompt: sourcePrompt || null,
    is_pwa: isPwa,
    is_jsx: isJsx,
    visibility,
    mutable,
  };

  const essential = new Set(["user_id", "slug", "title", "content"]);
  const optionalColumns = Object.keys(payload).filter((c) => !essential.has(c)).length;
  let inserted: { id: string } | null = null;
  let error: { message: string } | null = null;
  for (let attempt = 0; attempt <= optionalColumns; attempt++) {
    ({ data: inserted, error } = await admin.from("artifacts").insert(payload).select("id").single());
    if (!error) break;
    const missing = error.message.match(/[Cc]ould not find the '([^']+)' column/)?.[1];
    if (!missing || !(missing in payload) || essential.has(missing)) break;
    delete payload[missing];
  }

  if (error || !inserted) {
    return { error: `Could not save the artifact: ${error?.message ?? "insert failed"}`, status: 500 };
  }

  let connections = { manual: 0, auto: 0 };
  try {
    connections = await syncConnectionsForArtifact(admin, userId, { id: inserted.id, title, tags }, connectTo);
  } catch {
  }
  try {
    await syncMemoryLinksForArtifact(admin, userId, { id: inserted.id, title, tags });
  } catch {
  }

  const storedMutable = "mutable" in payload && mutable;
  if (storedMutable) {
    try {
      await recordArtifactVersion(admin, {
        artifactId: inserted.id,
        userId,
        title,
        storedContent,
        originalContent,
        contentHash: hash,
        message: "create",
        authorKind,
        authorKeyId,
        isJsx,
        parentVersionId: null,
      });
    } catch {
    }
  }

  const storedVisibility = "visibility" in payload ? visibility : "public";
  const url = `${await linkOrigin(admin, userId, storedVisibility)}/a/${slug}`;
  return {
    slug,
    url,
    visibility: storedVisibility,
    isJsx,
    isPwa,
    duplicate: false,
    id: inserted.id,
    connections,
    mutable: storedMutable,
  };
}
