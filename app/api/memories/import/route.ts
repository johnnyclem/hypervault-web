import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { embedMemoryBestEffort } from "@/lib/backends/embeddings";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  detectFileKind,
  extractFileText,
  titleFromFilename,
} from "@/lib/ingest/files";
import { digestGitHubRepo, parseGitHubRepoUrl } from "@/lib/ingest/github";
import { IngestError, clampMemoryContent } from "@/lib/ingest/limits";
import { scrapeUrlToMemory } from "@/lib/ingest/web";
import {
  autoTags,
  autoTitle,
  suggestLinkChangesForMemory,
  summarize,
  syncArtifactLinksForMemory,
} from "@/lib/memory";
import { resolveBranch } from "@/lib/mind/branches";
import { recordCommit } from "@/lib/mind/commits";
import type { LinkChange, MindChange } from "@/lib/mind/types";
import { conceptIdToMemoryId } from "@/lib/polytician/bridge";
import { looksLikePolyticianExport, parsePolyticianExport } from "@/lib/polytician/import";
import { upsertConcept } from "@/lib/polytician/repo";
import { rateLimit } from "@/lib/ratelimit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ApiIdentity } from "@/lib/api-auth";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 60;

type PreparedImport = {
  content: string;
  title: string;
  tags: string[];
  source: "file" | "github" | "web";
};

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const limited = rateLimit(`memory-import:${auth.identity.userId}`, 12, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Import rate limit reached — try again in a minute." }, { status: 429 });
  }

  const branchName = req.nextUrl.searchParams.get("branch");
  const contentType = req.headers.get("content-type") ?? "";

  let prepared: PreparedImport;
  try {
    if (contentType.includes("multipart/form-data")) {
      prepared = await prepareFileImport(req);
    } else {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        throw new IngestError("Body must be JSON with a `url`, a Polytician export, or multipart/form-data with a `file`.", 400);
      }
      if (looksLikePolyticianExport(body)) {
        return await importPolyticianExport(admin, auth.identity, body, branchName);
      }
      prepared = await prepareUrlImport(body);
    }
  } catch (err) {
    if (err instanceof IngestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Import failed unexpectedly — try again." }, { status: 500 });
  }

  const content = prepared.content;
  const title = (prepared.title.trim() || autoTitle(content)).slice(0, 160);
  const tags = [...new Set([...prepared.tags.map((t) => t.trim()).filter(Boolean), ...autoTags(content, title)])].slice(0, 12);
  const summary = summarize(content);

  const branch = await resolveBranch(admin, auth.identity.userId, branchName);
  if (!branch) {
    return NextResponse.json({ error: "No such branch — create it first via /api/mind/branches." }, { status: 404 });
  }

  const memoryId = crypto.randomUUID();

  let linkChanges: LinkChange[] = [];
  try {
    linkChanges = await suggestLinkChangesForMemory(admin, auth.identity.userId, branch, {
      id: memoryId,
      title,
      summary,
      tags,
    });
  } catch {
  }

  let commitId: string;
  try {
    commitId = await recordCommit(
      admin,
      auth.identity,
      branch.id,
      `import (${prepared.source}): ${title}`,
      [{ memory_id: memoryId, op: "create", title, content, summary, tags, source: prepared.source }],
      linkChanges
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "commit failed";
    if (message.includes("memories_source_check")) {
      return NextResponse.json(
        {
          error:
            "The database doesn't allow imported memory sources yet — run " +
            "supabase/migrations/0006_memory_import_sources.sql against your Supabase project " +
            "(SQL editor or `supabase db push`) to enable file, GitHub, and web imports.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: `Could not store the imported memory: ${message}` }, { status: 500 });
  }

  let links = linkChanges.length;
  if (branch.is_default) {
    try {
      links += await syncArtifactLinksForMemory(admin, auth.identity.userId, { id: memoryId, title, summary, tags });
    } catch {
    }
    await embedMemoryBestEffort(admin, auth.identity.userId, memoryId, `${title}\n${content}`);
  }
  const sourceLabel = { file: "file", github: "repository digest", web: "page" }[prepared.source];
  return NextResponse.json({
    id: memoryId,
    title,
    summary,
    tags,
    source: prepared.source,
    links,
    branch: branch.name,
    commit_id: commitId,
    message:
      links > 0
        ? `Imported the ${sourceLabel} and linked it to ${links} related memor${links === 1 ? "y" : "ies"} in your wiki.`
        : `Imported the ${sourceLabel} — it's in your private wiki now.`,
  });
}

async function prepareFileImport(req: NextRequest): Promise<PreparedImport> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new IngestError("Send the document as multipart/form-data with a `file` field.", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new IngestError("Attach the document under a `file` field.", 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new IngestError(`That file is over the ${MAX_UPLOAD_LABEL} import limit.`, 413);
  }

  const kind = detectFileKind(file.name, file.type);
  if (!kind) {
    throw new IngestError("Unsupported file type — import a PDF, DOCX, .md, or .txt file.", 415);
  }

  const text = await extractFileText(kind, new Uint8Array(await file.arrayBuffer()));
  if (!text) {
    throw new IngestError("No readable text found in that file.");
  }

  return {
    content: clampMemoryContent(text),
    title: titleFromFilename(file.name) || autoTitle(text),
    tags: [kind === "markdown" || kind === "text" ? "notes" : kind],
    source: "file",
  };
}

async function prepareUrlImport(parsed: unknown): Promise<PreparedImport> {
  const body = (parsed ?? {}) as Record<string, unknown>;
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    throw new IngestError("url is required — a GitHub repo or any web page.", 400);
  }

  const repo = parseGitHubRepoUrl(url);
  if (repo) {
    const digest = await digestGitHubRepo(repo);
    return { content: digest.content, title: digest.title, tags: digest.tags, source: "github" };
  }

  const page = await scrapeUrlToMemory(url);
  return { content: page.content, title: page.title, tags: page.tags, source: "web" };
}

const MAX_IMPORT_CONCEPTS = 200;

async function importPolyticianExport(
  admin: SupabaseClient,
  identity: ApiIdentity,
  body: unknown,
  branchName: string | null
): Promise<NextResponse> {
  const concepts = parsePolyticianExport(body).slice(0, MAX_IMPORT_CONCEPTS);
  if (concepts.length === 0) {
    return NextResponse.json({ error: "No importable concepts found in that export." }, { status: 400 });
  }

  const branch = await resolveBranch(admin, identity.userId, branchName);
  if (!branch) {
    return NextResponse.json({ error: "No such branch — create it first via /api/mind/branches." }, { status: 404 });
  }

  const changes: MindChange[] = [];
  const conceptWrites: { memoryId: string; conceptId: string; namespace: string; version: number; updatedAtMs: number; thoughtform?: unknown }[] = [];
  for (const c of concepts) {
    const conceptId = c.conceptId ?? crypto.randomUUID();
    const memoryId = conceptIdToMemoryId(conceptId);
    const tags = [...new Set([...c.tags, ...autoTags(c.content, c.title)])].slice(0, 12);
    changes.push({
      memory_id: memoryId,
      op: "create",
      title: c.title,
      content: c.content,
      summary: summarize(c.content),
      tags,
      source: "agent",
    });
    conceptWrites.push({
      memoryId,
      conceptId,
      namespace: c.namespace,
      version: c.version,
      updatedAtMs: c.updatedAtMs ?? Date.now(),
      thoughtform: c.thoughtform,
    });
  }

  let commitId: string;
  try {
    commitId = await recordCommit(admin, identity, branch.id, `import: polytician export (${concepts.length} concepts)`, changes);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not store the Polytician export: ${err instanceof Error ? err.message : "commit failed"}` },
      { status: 500 }
    );
  }

  for (const w of conceptWrites) {
    try {
      await upsertConcept(admin, identity.userId, w);
    } catch {
    }
  }

  return NextResponse.json({
    imported: concepts.length,
    branch: branch.name,
    commit_id: commitId,
    source: "polytician",
    message: `Imported ${concepts.length} concept${concepts.length === 1 ? "" : "s"} from Polytician into your wiki.`,
  });
}
