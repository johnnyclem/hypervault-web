import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { saveArtifactCore } from "@/lib/artifacts/save";
import { detectJsx, wrapJsxAsHtml } from "@/lib/jsx";
import { injectSourcePromptMeta } from "@/lib/pwa";
import { rateLimit } from "@/lib/ratelimit";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeVisibility } from "@/lib/visibility";

const MAX_CONTENT_BYTES = 1_000_000;
const MAX_SOURCE_PROMPT_CHARS = 10_000;

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limited = rateLimit(`save:${auth.identity.userId}`, 30, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Rate limit reached — try again in a minute." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) {
    return NextResponse.json({ error: "content is required — the HTML or JSX to save." }, { status: 400 });
  }
  if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
    return NextResponse.json(
      { error: "Artifact is over the 1 MB limit. Trim embedded assets and try again." },
      { status: 413 }
    );
  }

  const title = (typeof body.title === "string" && body.title.trim()) || "Untitled";
  const type = (typeof body.type === "string" && body.type.trim()) || "html";
  const tags = Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === "string").slice(0, 20) : [];
  const connectTo = Array.isArray(body.connect_to)
    ? body.connect_to.filter((t) => typeof t === "string").slice(0, 20)
    : [];
  const makePwa = body.make_pwa !== false;
  const forceHtml = body.force_html === true;
  const mutable = body.mutable === true;
  const visibility = normalizeVisibility(body.visibility, "private");
  const sourcePrompt = typeof body.source_prompt === "string" ? body.source_prompt.trim() : "";
  if (sourcePrompt.length > MAX_SOURCE_PROMPT_CHARS) {
    return NextResponse.json(
      { error: `source_prompt is over the ${MAX_SOURCE_PROMPT_CHARS.toLocaleString()} character limit.` },
      { status: 400 }
    );
  }

  const detection = forceHtml ? { isJsx: false, confidence: 0, signals: [] } : detectJsx(content);
  const isJsx = detection.isJsx || (!forceHtml && type.toLowerCase() === "jsx");
  let storedContent = isJsx ? wrapJsxAsHtml(content, title) : content;

  if (sourcePrompt) {
    storedContent = injectSourcePromptMeta(storedContent, sourcePrompt);
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const result = await saveArtifactCore(admin, auth.identity.userId, {
    storedContent,
    hashContent: content,
    title,
    type: isJsx ? "react" : type,
    tags,
    connectTo,
    originalContent: isJsx ? content : null,
    sourcePrompt: sourcePrompt || null,
    isPwa: makePwa,
    isJsx,
    visibility,
    mutable,
    authorKind: auth.identity.via === "api-key" ? "agent" : "user",
    authorKeyId: auth.identity.via === "api-key" ? auth.identity.keyId ?? null : null,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (result.duplicate) {
    const existingVisibility = result.existing!.visibility;
    return NextResponse.json({
      url: result.url,
      slug: result.slug,
      is_jsx: result.isJsx,
      is_pwa: result.isPwa,
      visibility: existingVisibility,
      duplicate: true,
      message:
        `This exact content is already in your vault as “${result.existing!.title}” — here's its permanent link instead of a copy.` +
        (existingVisibility === visibility
          ? ""
          : ` Note: the existing artifact is ${existingVisibility}, and re-saving doesn't change that — flip it from your vault dashboard if you want it ${visibility}.`),
    });
  }

  return NextResponse.json({
    url: result.url,
    slug: result.slug,
    is_jsx: isJsx,
    is_pwa: makePwa,
    visibility: result.visibility,
    mutable: result.mutable,
    connections: result.connections,
    message: `${
      isJsx
        ? "Detected React/JSX — I made it work for you! Your component is now a standalone installable page."
        : "Saved! Your artifact has a permanent home."
    }${
      result.visibility === "private"
        ? " It's private — only you (and anyone you invite) can open the link."
        : ""
    }${
      result.mutable
        ? " It's mutable — read and rewrite it via the artifact content API and every write is kept as a version."
        : ""
    }`,
  });
}
