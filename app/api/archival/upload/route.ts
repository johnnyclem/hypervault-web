import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { saveArtifactCore } from "@/lib/artifacts/save";
import { autoTitle } from "@/lib/memory";
import { avError, BRIDGE_RATE_LIMIT } from "@/lib/polytician/bridge";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req, { keyRateLimit: BRIDGE_RATE_LIMIT });
  if ("error" in auth) return avError(auth.status, "UNAUTHORIZED", auth.error);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return avError(400, "BAD_REQUEST", "Body must be JSON.");
  }

  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) return avError(400, "BAD_REQUEST", "content is required.");
  const contentType = body.contentType === "json" ? "json" : "markdown";
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string").slice(0, 20) : [];
  const metadata = (body.metadata ?? {}) as Record<string, unknown>;
  const title =
    (typeof metadata.title === "string" && metadata.title.trim()) ||
    (typeof metadata.conceptId === "string" && `Concept ${metadata.conceptId}`) ||
    autoTitle(content);

  const admin = createAdminClient();
  if (!admin) return avError(503, "NOT_CONFIGURED", "Server is not configured with Supabase credentials.");

  const result = await saveArtifactCore(admin, auth.identity.userId, {
    storedContent: content,
    title,
    type: contentType,
    tags,
    visibility: "private",
    isPwa: false,
    isJsx: false,
  });
  if ("error" in result) return avError(result.status, "ARCHIVE_FAILED", result.error);

  return NextResponse.json({
    txId: result.slug,
    url: result.url,
    timestamp: Date.now(),
    tags,
    size: new TextEncoder().encode(content).length,
    duplicate: result.duplicate,
  });
}
