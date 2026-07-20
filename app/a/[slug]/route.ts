import type { NextRequest } from "next/server";
import { injectTurnActionsBar, shouldShowTurnActionsBar } from "@/lib/chat/turn-actions-html";
import { baseDomainForHost } from "@/lib/domains";
import { wrapJsxAsHtml } from "@/lib/jsx";
import { injectArtifactMeta } from "@/lib/pwa";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { appUrl } from "@/lib/utils";
import { canViewerOpenArtifact, fetchArtifactBySlug, isPrivateArtifact } from "@/lib/visibility";

export const dynamic = "force-dynamic";

type ServableArtifact = {
  slug: string;
  title: string;
  content: string;
  original_content: string | null;
  is_jsx: boolean;
  is_pwa: boolean;
  source_prompt: string | null;
  tags: string[] | null;
  user_id: string;
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const currentBase = baseDomainForHost(req.headers.get("host"));
  const linkBase = currentBase ? `https://${currentBase}` : appUrl();
  const admin = createAdminClient();
  if (!admin) {
    return new Response("HyperVault is not configured yet.", { status: 503 });
  }

  const artifact = await fetchArtifactBySlug<ServableArtifact>(
    admin,
    slug,
    "slug, title, content, original_content, is_jsx, is_pwa, source_prompt, tags, user_id"
  );

  if (!artifact) {
    return new Response(notFoundHtml(slug), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  let viewerId: string | null | undefined;
  const resolveViewer = async () => {
    if (viewerId === undefined) viewerId = (await getUser())?.id ?? null;
    return viewerId;
  };

  const isPrivate = isPrivateArtifact(artifact);
  if (isPrivate) {
    const viewer = await resolveViewer();
    if (!(await canViewerOpenArtifact(admin, artifact, viewer))) {
      return new Response(privateHtml(Boolean(viewer), artifact.slug, linkBase), {
        status: viewer ? 403 : 401,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
      });
    }
  }

  const repairUrl =
    artifact.is_jsx && (await resolveViewer()) === artifact.user_id
      ? `${linkBase}/vault?repair=${encodeURIComponent(artifact.slug)}`
      : undefined;
  const baseHtml =
    artifact.is_jsx && artifact.original_content
      ? wrapJsxAsHtml(artifact.original_content, artifact.title, { repairUrl })
      : artifact.content;

  let html = injectArtifactMeta(baseHtml, {
    slug: artifact.slug,
    title: artifact.title,
    isPwa: artifact.is_pwa,
    sourcePrompt: artifact.source_prompt,
  });

  if (shouldShowTurnActionsBar(artifact)) {
    html = injectTurnActionsBar(html, { slug: artifact.slug, title: artifact.title });
  }

  const personalized = Boolean(repairUrl);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": isPrivate || personalized ? "private, no-store" : "public, max-age=0, s-maxage=60",
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
}

function shellHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · HyperVault</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#09090b; color:#fafafa;
    font-family: ui-sans-serif, system-ui, sans-serif; text-align:center; }
  a { color:#22d3ee; }
</style>
</head>
<body>
<div>
${body}
</div>
</body>
</html>`;
}

function notFoundHtml(slug: string): string {
  return shellHtml(
    "Not found",
    `  <p style="font-size:48px;margin:0">🕳️</p>
  <h1>Nothing at /a/${slug.replace(/[^a-z0-9-]/gi, "")}</h1>
  <p>This artifact doesn't exist (or drifted off into space).</p>
  <p><a href="/">Back to HyperVault</a></p>`
  );
}

function privateHtml(signedIn: boolean, slug: string, base: string): string {
  const loginHref = `${base}/login?next=${encodeURIComponent(`/a/${slug}`)}`;
  const retryScript = `<script>
(function () {
  try {
    var hasSession = document.cookie.split("; ").some(function (c) {
      var name = c.split("=")[0];
      return name.indexOf("sb-") === 0 && name.indexOf("-auth-token") !== -1 && name.indexOf("code-verifier") === -1;
    });
    var key = "hv-lock-retry:" + location.pathname;
    if (hasSession && !sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, "1");
      setTimeout(function () { location.reload(); }, 400);
    }
  } catch (e) {}
})();
</script>`;
  return shellHtml(
    "Private artifact",
    `  <p style="font-size:48px;margin:0">🔒</p>
  <h1>This artifact is private</h1>
  ${
    signedIn
      ? `<p>Your account doesn't have access — ask the owner to invite you from their vault.</p>`
      : `<p>If it's yours (or was shared with you), sign in and open the link again.</p>
  <p><a href="${loginHref}">Sign in to HyperVault</a></p>
${retryScript}`
  }
  <p><a href="${base}">Back to HyperVault</a></p>`
  );
}
