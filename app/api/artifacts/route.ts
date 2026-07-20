import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { normalizeIconGlyph } from "@/lib/pwa";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/utils";
import { artifactRefColumn, isMissingColumnError, PRIVACY_MIGRATION_HINT } from "@/lib/visibility";

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const list = (columns: string) =>
    admin
      .from("artifacts")
      .select(columns)
      .eq("user_id", auth.identity.userId)
      .order("created_at", { ascending: false })
      .limit(200);

  let res = await list("slug, title, type, tags, source_prompt, is_pwa, is_jsx, visibility, icon, created_at");
  if (res.error && isMissingColumnError(res.error, "icon")) {
    res = await list("slug, title, type, tags, source_prompt, is_pwa, is_jsx, visibility, created_at");
  }
  if (res.error && isMissingColumnError(res.error, "visibility")) {
    res = await list("slug, title, type, tags, source_prompt, is_pwa, is_jsx, created_at");
  }
  const data = res.data as { slug: string; [key: string]: unknown }[] | null;

  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });

  return NextResponse.json({
    items: (data ?? []).map((a) => ({ ...a, url: `${appUrl()}/a/${a.slug}` })),
  });
}

const ICON_MIGRATION_HINT =
  "The database is missing the artifact icon column — apply supabase/migrations/0021_artifact_icon.sql " +
  "(`supabase db push`, or paste it into the Supabase SQL editor), then try again.";

export async function PATCH(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const ref =
    (typeof body.id === "string" && body.id.trim()) || (typeof body.slug === "string" && body.slug.trim()) || "";
  if (!ref) {
    return NextResponse.json({ error: "id or slug is required — which artifact to update." }, { status: 400 });
  }

  const update: { visibility?: "public" | "private"; icon?: string | null } = {};

  if ("visibility" in body) {
    if (body.visibility !== "public" && body.visibility !== "private") {
      return NextResponse.json({ error: `visibility must be "public" or "private".` }, { status: 400 });
    }
    update.visibility = body.visibility;
  }

  if ("icon" in body) {
    if (body.icon !== null && typeof body.icon !== "string") {
      return NextResponse.json({ error: "icon must be a string or null." }, { status: 400 });
    }
    update.icon = normalizeIconGlyph(body.icon);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update — provide visibility or icon." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data, error } = await admin
    .from("artifacts")
    .update(update)
    .eq("user_id", auth.identity.userId)
    .eq(artifactRefColumn(ref), ref)
    .select("id, slug, title, visibility, icon");

  if (error) {
    if (isMissingColumnError(error, "visibility")) {
      return NextResponse.json({ error: PRIVACY_MIGRATION_HINT }, { status: 503 });
    }
    if (isMissingColumnError(error, "icon")) {
      return NextResponse.json({ error: ICON_MIGRATION_HINT }, { status: 503 });
    }
    return NextResponse.json({ error: `Could not update the artifact: ${error.message}` }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: `No artifact matching "${ref}" in your vault.` }, { status: 404 });
  }

  return NextResponse.json({
    artifact: data[0],
    message: patchMessage(data[0].title, update),
  });
}

function patchMessage(title: string, update: { visibility?: "public" | "private"; icon?: string | null }): string {
  if (update.visibility === "private") {
    return `“${title}” is now private — only you and anyone you've invited can open it.`;
  }
  if (update.visibility === "public") {
    return `“${title}” is now public — anyone with the link can open it.`;
  }
  if (update.icon) return `“${title}” now shows “${update.icon}” as its home-screen icon.`;
  return `“${title}” is back to its automatic home-screen icon.`;
}

export async function DELETE(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const ref =
    (typeof body.id === "string" && body.id.trim()) || (typeof body.slug === "string" && body.slug.trim()) || "";
  if (!ref) {
    return NextResponse.json({ error: "id or slug is required — which artifact to delete." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data, error } = await admin
    .from("artifacts")
    .delete()
    .eq("user_id", auth.identity.userId)
    .eq(artifactRefColumn(ref), ref)
    .select("id, slug, title");

  if (error) return NextResponse.json({ error: `Could not delete the artifact: ${error.message}` }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: `No artifact matching "${ref}" in your vault.` }, { status: 404 });
  }

  return NextResponse.json({
    deleted: data[0],
    message: `Deleted “${data[0].title}” — its link is gone for good.`,
  });
}
