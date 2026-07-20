import type { NextRequest } from "next/server";
import { artifactManifest } from "@/lib/pwa";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { canViewerOpenArtifact, fetchArtifactBySlug, isPrivateArtifact } from "@/lib/visibility";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const admin = createAdminClient();
  if (!admin) return new Response("Not configured", { status: 503 });

  const artifact = await fetchArtifactBySlug<{ slug: string; title: string }>(admin, slug, "slug, title");
  if (!artifact) return new Response("Not found", { status: 404 });

  const isPrivate = isPrivateArtifact(artifact);
  if (isPrivate) {
    const viewer = await getUser();
    if (!(await canViewerOpenArtifact(admin, artifact, viewer?.id ?? null))) {
      return new Response("Not found", { status: 404 });
    }
  }

  return Response.json(artifactManifest(artifact), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": isPrivate ? "private, no-store" : "public, max-age=3600",
    },
  });
}
