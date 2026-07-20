import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { decryptSecret } from "@/lib/backends/crypto";
import { contentHash } from "@/lib/hash";
import { startJob } from "@/lib/jobs";
import { wrapJsxAsHtml } from "@/lib/jsx";
import { repairArtifactSource, type RepairKind } from "@/lib/repair";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

const MAX_RENDER_ERROR_CHARS = 2_000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const backendId = typeof body.backend_id === "string" ? body.backend_id.trim() : "";
  const renderError =
    typeof body.render_error === "string" ? body.render_error.slice(0, MAX_RENDER_ERROR_CHARS) : null;

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }
  const userId = auth.identity.userId;
  const { slug } = await params;

  const { data: artifact, error: fetchError } = await admin
    .from("artifacts")
    .select("id, slug, title, content, original_content, is_jsx")
    .eq("user_id", userId)
    .eq("slug", slug)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!artifact) return NextResponse.json({ error: "No artifact matching that link in your vault." }, { status: 404 });

  const kind: RepairKind = artifact.is_jsx ? "jsx" : "html";
  const brokenSource =
    artifact.is_jsx && typeof artifact.original_content === "string" && artifact.original_content.trim()
      ? artifact.original_content
      : artifact.content;
  if (typeof brokenSource !== "string" || !brokenSource.trim()) {
    return NextResponse.json({ error: "This artifact has no source to repair." }, { status: 400 });
  }

  const backendQuery = admin
    .from("llm_backends")
    .select("id, name, provider, base_url, default_model, api_key_cipher")
    .eq("user_id", userId);
  const { data: backend } = backendId
    ? await backendQuery.eq("id", backendId).maybeSingle()
    : await backendQuery
        .order("last_used_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  if (!backend) {
    return NextResponse.json(
      {
        error: backendId
          ? "That backend isn't connected to your account."
          : "No LLM backend is connected — connect one (OpenAI, Anthropic, a local model, …) from Chat, then try the repair again.",
        needs_backend: true,
      },
      { status: 400 }
    );
  }

  const started = await startJob(
    admin,
    { userId, kind: "artifact_repair", label: `Repairing “${artifact.title}”`, input: { slug, artifact_id: artifact.id } },
    async () => {
      const result = await repairArtifactSource(
        {
          provider: backend.provider,
          baseUrl: backend.base_url,
          model: backend.default_model,
          apiKey: backend.api_key_cipher ? decryptSecret(backend.api_key_cipher) : null,
        },
        brokenSource,
        kind,
        artifact.title,
        renderError
      );

      if (!result.ok) throw new Error(result.error);

      if (!result.changed) {
        return {
          changed: false,
          backend: { id: backend.id, name: backend.name },
          model: result.model,
          message: renderError
            ? `${backend.name} looked at the captured error and the source but didn't change anything — it couldn't ` +
              `find the cause in this file. Open the source to check, or try a different backend.`
            : `${backend.name} looked it over but didn't change anything — the render error may be a runtime bug ` +
              `rather than a syntax slip. Open the source to check, or try a different backend.`,
        };
      }

      const newSource = result.code;
      const update: Record<string, unknown> = artifact.is_jsx
        ? {
            original_content: newSource,
            content: wrapJsxAsHtml(newSource, artifact.title),
            content_hash: contentHash(newSource),
          }
        : { content: newSource, content_hash: contentHash(newSource) };

      let { error: updateError } = await admin.from("artifacts").update(update).eq("id", artifact.id);
      if (updateError && /content_hash/i.test(updateError.message)) {
        delete update.content_hash;
        ({ error: updateError } = await admin.from("artifacts").update(update).eq("id", artifact.id));
      }
      if (updateError) throw new Error(`Repaired, but couldn't save it: ${updateError.message}`);

      void admin.from("llm_backends").update({ last_used_at: new Date().toISOString() }).eq("id", backend.id);

      return {
        changed: true,
        backend: { id: backend.id, name: backend.name },
        model: result.model,
        source: newSource,
        message: `${backend.name} took a pass at it — reload the artifact to see if it renders now.`,
      };
    }
  );

  if ("error" in started) {
    return NextResponse.json({ error: `Could not start the repair: ${started.error}` }, { status: 500 });
  }

  return NextResponse.json({ job_id: started.id, status: "pending" }, { status: 202 });
}
