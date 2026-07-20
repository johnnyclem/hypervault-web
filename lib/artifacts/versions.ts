import type { SupabaseClient } from "@supabase/supabase-js";
import { contentHash } from "@/lib/hash";
import { detectJsx, wrapJsxAsHtml } from "@/lib/jsx";
import { injectSourcePromptMeta } from "@/lib/pwa";
import { isMissingColumnError, isMissingTableError } from "@/lib/visibility";


export const MUTABLE_MIGRATION_HINT =
  "The database is missing mutable-artifact support — apply " +
  "supabase/migrations/0026_mutable_artifacts.sql (`supabase db push`, or paste " +
  "it into the Supabase SQL editor), then try again.";

export type PreparedContent = {
  storedContent: string;
  originalContent: string | null;
  isJsx: boolean;
  type: string;
};

export function preprocessArtifactContent(input: {
  content: string;
  title: string;
  type?: string;
  forceHtml?: boolean;
  sourcePrompt?: string | null;
}): PreparedContent {
  const type = (input.type ?? "html").trim() || "html";
  const forceHtml = input.forceHtml === true;
  const detection = forceHtml ? { isJsx: false } : detectJsx(input.content);
  const isJsx = detection.isJsx || (!forceHtml && type.toLowerCase() === "jsx");

  let storedContent = isJsx ? wrapJsxAsHtml(input.content, input.title) : input.content;
  if (input.sourcePrompt) {
    storedContent = injectSourcePromptMeta(storedContent, input.sourcePrompt);
  }

  return {
    storedContent,
    originalContent: isJsx ? input.content : null,
    isJsx,
    type: isJsx ? "react" : type,
  };
}

export type ArtifactVersion = {
  id: string;
  artifact_id: string;
  parent_version_id: string | null;
  title: string;
  content: string;
  original_content: string | null;
  content_hash: string;
  message: string;
  author_kind: "user" | "agent" | "system";
  author_key_id: string | null;
  is_jsx: boolean;
  created_at: string;
};

export async function headVersion(
  admin: SupabaseClient,
  artifactId: string
): Promise<ArtifactVersion | null> {
  const { data, error } = await admin
    .from("artifact_versions")
    .select(
      "id, artifact_id, parent_version_id, title, content, original_content, content_hash, message, author_kind, author_key_id, is_jsx, created_at"
    )
    .eq("artifact_id", artifactId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error, "artifact_versions")) return null;
    throw new Error(error.message);
  }
  return (data as ArtifactVersion | null) ?? null;
}

export type RecordVersionInput = {
  artifactId: string;
  userId: string;
  title: string;
  storedContent: string;
  originalContent?: string | null;
  contentHash: string;
  message?: string;
  authorKind?: "user" | "agent" | "system";
  authorKeyId?: string | null;
  isJsx?: boolean;
  parentVersionId?: string | null;
};

export async function recordArtifactVersion(
  admin: SupabaseClient,
  input: RecordVersionInput
): Promise<ArtifactVersion | null> {
  let parentId = input.parentVersionId ?? null;
  if (input.parentVersionId === undefined) {
    const head = await headVersion(admin, input.artifactId);
    parentId = head?.id ?? null;
  }

  const { data, error } = await admin
    .from("artifact_versions")
    .insert({
      artifact_id: input.artifactId,
      user_id: input.userId,
      parent_version_id: parentId,
      title: input.title,
      content: input.storedContent,
      original_content: input.originalContent ?? null,
      content_hash: input.contentHash,
      message: input.message ?? "",
      author_kind: input.authorKind ?? "user",
      author_key_id: input.authorKeyId ?? null,
      is_jsx: input.isJsx ?? false,
    })
    .select(
      "id, artifact_id, parent_version_id, title, content, original_content, content_hash, message, author_kind, author_key_id, is_jsx, created_at"
    )
    .single();

  if (error) {
    if (isMissingTableError(error, "artifact_versions")) return null;
    throw new Error(error.message);
  }
  return data as ArtifactVersion;
}

export type VersionSummary = {
  id: string;
  parent_version_id: string | null;
  title: string;
  message: string;
  author_kind: "user" | "agent" | "system";
  author_key_id: string | null;
  content_hash: string;
  is_jsx: boolean;
  created_at: string;
  is_head: boolean;
  content?: string;
  original_content?: string | null;
};

export async function listArtifactVersions(
  admin: SupabaseClient,
  artifactId: string,
  opts: { full?: boolean; limit?: number } = {}
): Promise<VersionSummary[]> {
  const columns = opts.full
    ? "id, parent_version_id, title, message, author_kind, author_key_id, content_hash, is_jsx, content, original_content, created_at"
    : "id, parent_version_id, title, message, author_kind, author_key_id, content_hash, is_jsx, created_at";
  const { data, error } = await admin
    .from("artifact_versions")
    .select(columns)
    .eq("artifact_id", artifactId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (error) {
    if (isMissingTableError(error, "artifact_versions")) return [];
    throw new Error(error.message);
  }
  const rows = (data ?? []) as unknown as VersionSummary[];
  return rows.map((row, index) => ({ ...row, is_head: index === 0 }));
}

export function isMissingMutableColumn(error: unknown): boolean {
  return isMissingColumnError(error as never, "mutable");
}
