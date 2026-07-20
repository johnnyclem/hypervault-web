import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { artifactSlugFromUrl, findSourcePromptMeta, isHyperVaultHost } from "@/lib/extract";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewerOpenArtifact, fetchArtifactBySlug } from "@/lib/visibility";

type ExtractableArtifact = {
  slug: string;
  title: string;
  content: string | null;
  source_prompt: string | null;
};

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const raw = req.nextUrl.searchParams.get("url")?.trim() ?? "";
  if (!raw) {
    return NextResponse.json({ error: "url query parameter is required — the artifact's full URL." }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Pass a full artifact URL, starting with http:// or https://." }, { status: 400 });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json({ error: "Pass a full artifact URL, starting with http:// or https://." }, { status: 400 });
  }
  if (!isHyperVaultHost(target.hostname)) {
    return NextResponse.json(
      { error: `${target.hostname} is not a HyperVault domain — only HyperVault artifact URLs carry a source prompt.` },
      { status: 400 }
    );
  }

  const slug = artifactSlugFromUrl(target);
  if (!slug) {
    return NextResponse.json({ error: "That URL doesn't point to an artifact page (expected /a/<slug>)." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const artifact = await fetchArtifactBySlug<ExtractableArtifact>(admin, slug, "slug, title, content, source_prompt");
  if (!artifact || !(await canViewerOpenArtifact(admin, artifact, auth.identity.userId))) {
    return NextResponse.json(
      { error: "No artifact at that URL (or it isn't accessible to your account)." },
      { status: 404 }
    );
  }

  const prompt = artifact.source_prompt?.trim() || findSourcePromptMeta(artifact.content ?? "");
  if (!prompt) {
    return NextResponse.json({
      found: false,
      source_prompt: null,
      url: raw,
      slug: artifact.slug,
      title: artifact.title,
      message:
        "No source prompt is embedded in this artifact — it was saved without one. " +
        "You can still iterate on the page content itself.",
    });
  }

  return NextResponse.json({
    found: true,
    source_prompt: prompt,
    url: raw,
    slug: artifact.slug,
    title: artifact.title,
    message: "Source prompt extracted — use it to understand the original intent and build on it.",
  });
}
