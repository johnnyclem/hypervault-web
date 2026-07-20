import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbError } from "@/lib/backends/schema-compat";

export type ArtifactVisibility = "public" | "private";

export function normalizeVisibility(
  value: unknown,
  fallback: ArtifactVisibility = "private"
): ArtifactVisibility {
  return value === "public" || value === "private" ? value : fallback;
}

export function isPrivateArtifact(artifact: { visibility?: string | null }): boolean {
  return (artifact.visibility ?? "public") === "private";
}

export function canViewArtifact(
  artifact: { user_id?: string | null; visibility?: string | null },
  viewerId: string | null,
  isSharedWithViewer = false
): boolean {
  if (!isPrivateArtifact(artifact)) return true;
  if (!viewerId) return false;
  return viewerId === artifact.user_id || isSharedWithViewer;
}

export function isMissingColumnError(error: DbError, column: string): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (!message.includes(column)) return false;
  return error.code === "PGRST204" || error.code === "42703" || /column|schema cache/i.test(message);
}

export function isMissingTableError(error: DbError, table: string): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (!message.includes(table)) return false;
  return error.code === "PGRST205" || error.code === "42P01" || /schema cache|does not exist/i.test(message);
}

export const PRIVACY_MIGRATION_HINT =
  "The database is missing artifact privacy — apply supabase/migrations/0016_artifact_privacy_sharing.sql " +
  "(`supabase db push`, or paste it into the Supabase SQL editor), then try again.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function artifactRefColumn(ref: string): "id" | "slug" {
  return UUID_RE.test(ref) ? "id" : "slug";
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export type ViewableArtifact = {
  id?: string;
  user_id?: string;
  visibility?: string | null;
};

export async function fetchArtifactBySlug<T extends object>(
  admin: SupabaseClient,
  slug: string,
  columns: string
): Promise<(T & ViewableArtifact) | null> {
  const gated = await admin
    .from("artifacts")
    .select(`id, user_id, visibility, ${columns}`)
    .eq("slug", slug)
    .maybeSingle();
  if (gated.data) return gated.data as unknown as T & ViewableArtifact;
  if (!isMissingColumnError(gated.error, "visibility")) return null;

  const { data } = await admin.from("artifacts").select(columns).eq("slug", slug).maybeSingle();
  return (data as (T & ViewableArtifact) | null) ?? null;
}

export async function isArtifactSharedWith(
  client: SupabaseClient,
  artifactId: string,
  userId: string
): Promise<boolean> {
  const { data } = await client
    .from("artifact_shares")
    .select("id")
    .eq("artifact_id", artifactId)
    .eq("shared_with_id", userId)
    .maybeSingle();
  return Boolean(data);
}

export async function canViewerOpenArtifact(
  admin: SupabaseClient,
  artifact: ViewableArtifact,
  viewerId: string | null
): Promise<boolean> {
  if (!isPrivateArtifact(artifact)) return true;
  if (!viewerId) return false;
  if (viewerId === artifact.user_id) return true;
  if (!artifact.id) return false;
  return isArtifactSharedWith(admin, artifact.id, viewerId);
}
