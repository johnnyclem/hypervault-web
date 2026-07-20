import { iconGlyph, iconGradient } from "@/lib/pwa";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { canViewerOpenArtifact, fetchArtifactBySlug, isPrivateArtifact } from "@/lib/visibility";

export type ResolvedIcon = {
  glyph: string;
  gradient: [string, string];
  isPrivate: boolean;
};

type IconArtifact = { slug: string; title: string; icon?: string | null };

async function fetchIconArtifact(admin: ReturnType<typeof createAdminClient>, slug: string) {
  if (!admin) return null;
  const withIcon = await fetchArtifactBySlug<IconArtifact>(admin, slug, "slug, title, icon");
  if (withIcon) return withIcon;
  return fetchArtifactBySlug<{ slug: string; title: string }>(admin, slug, "slug, title");
}

export async function resolveArtifactIcon(slug: string): Promise<ResolvedIcon | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  const artifact = await fetchIconArtifact(admin, slug);
  if (!artifact) return null;

  const isPrivate = isPrivateArtifact(artifact);
  if (isPrivate) {
    const viewer = await getUser();
    if (!(await canViewerOpenArtifact(admin, artifact, viewer?.id ?? null))) return null;
  }

  return {
    glyph: iconGlyph((artifact as IconArtifact).icon, artifact.title),
    gradient: iconGradient(artifact.slug),
    isPrivate,
  };
}
