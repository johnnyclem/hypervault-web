import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { createConnections, resolveConnectTargets } from "@/lib/connections";
import { createMemoryArtifactLinks, toLinkChanges } from "@/lib/memory";
import { ensureMainBranch, getBranchByName } from "@/lib/mind/branches";
import { recordCommit } from "@/lib/mind/commits";
import { createAdminClient } from "@/lib/supabase/admin";

type Ref = { id: string; kind: "artifact" | "memory" };

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const userId = auth.identity.userId;
  const mainBranch = await getBranchByName(admin, userId, "main");
  const [{ data: connections, error }, { data: memoryLinks }, { data: bridges }] = await Promise.all([
    admin.from("connections").select("id, a_id, b_id, kind, created_at").eq("user_id", userId).limit(1000),
    mainBranch
      ? admin
          .from("memory_links")
          .select("id, a_id, b_id, kind, created_at")
          .eq("user_id", userId)
          .eq("branch_id", mainBranch.id)
          .limit(1000)
      : Promise.resolve({ data: [] as { id: string; a_id: string; b_id: string; kind: string; created_at: string }[] }),
    admin
      .from("memory_artifact_links")
      .select("id, memory_id, artifact_id, kind, created_at")
      .eq("user_id", userId)
      .limit(1000),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    connections: connections ?? [],
    memory_links: memoryLinks ?? [],
    memory_artifact_links: bridges ?? [],
  });
}

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const source = typeof body.source === "string" ? body.source.trim() : "";
  const target = typeof body.target === "string" ? body.target.trim() : "";
  if (!source || !target) {
    return NextResponse.json(
      { error: "source and target are required — artifact ids/slugs/titles or memory ids/titles." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const userId = auth.identity.userId;
  const [{ data: artifacts, error: artifactsError }, { data: memories }] = await Promise.all([
    admin.from("artifacts").select("id, slug, title, tags").eq("user_id", userId).limit(500),
    admin.from("memories").select("id, title").eq("user_id", userId).limit(500),
  ]);
  if (artifactsError) return NextResponse.json({ error: artifactsError.message }, { status: 500 });

  const allArtifacts = artifacts ?? [];
  const allMemories = memories ?? [];
  const artifactIds = new Set(allArtifacts.map((a) => a.id));
  const memoryIds = new Set(allMemories.map((m) => m.id));
  const memoryByTitle = new Map(allMemories.map((m) => [m.title.trim().toLowerCase(), m.id]));

  const resolve = (ref: string): Ref | null => {
    if (artifactIds.has(ref)) return { id: ref, kind: "artifact" };
    if (memoryIds.has(ref)) return { id: ref, kind: "memory" };
    const artifactId = resolveConnectTargets([ref], allArtifacts)[0];
    if (artifactId) return { id: artifactId, kind: "artifact" };
    const memoryId = memoryByTitle.get(ref.trim().toLowerCase());
    return memoryId ? { id: memoryId, kind: "memory" } : null;
  };

  const from = resolve(source);
  const to = resolve(target);
  if (!from || !to) {
    return NextResponse.json(
      { error: `Could not find ${!from ? `"${source}"` : `"${target}"`} among your artifacts or memories.` },
      { status: 404 }
    );
  }
  if (from.id === to.id) {
    return NextResponse.json({ error: "An item cannot connect to itself." }, { status: 400 });
  }

  try {
    if (from.kind === "artifact" && to.kind === "artifact") {
      await createConnections(admin, userId, from.id, [to.id], "manual");
    } else if (from.kind === "memory" && to.kind === "memory") {
      const branch = await ensureMainBranch(admin, userId);
      await recordCommit(
        admin,
        auth.identity,
        branch.id,
        "link: connect two memories",
        [],
        toLinkChanges(from.id, [to.id], "manual")
      );
    } else {
      const memoryId = from.kind === "memory" ? from.id : to.id;
      const artifactId = from.kind === "artifact" ? from.id : to.id;
      await createMemoryArtifactLinks(admin, userId, [{ memoryId, artifactId }], "manual");
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Could not create the connection: ${e instanceof Error ? e.message : "unknown error"}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ connected: [from.id, to.id], message: "Connected — check the graph view!" });
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
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data: memoryLink } = await admin
    .from("memory_links")
    .select("id, a_id, b_id, kind, branch_id")
    .eq("id", id)
    .eq("user_id", auth.identity.userId)
    .maybeSingle();
  if (memoryLink) {
    try {
      await recordCommit(admin, auth.identity, memoryLink.branch_id, "unlink: disconnect two memories", [], [
        { a_id: memoryLink.a_id, b_id: memoryLink.b_id, op: "remove", kind: memoryLink.kind as "manual" | "auto" },
      ]);
    } catch (e) {
      return NextResponse.json(
        { error: `Could not remove the link: ${e instanceof Error ? e.message : "unknown error"}` },
        { status: 500 }
      );
    }
    return NextResponse.json({ deleted: id });
  }

  for (const table of ["connections", "memory_artifact_links"] as const) {
    const { data, error } = await admin
      .from(table)
      .delete()
      .eq("id", id)
      .eq("user_id", auth.identity.userId)
      .select("id");
    if (error && table === "connections") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (data && data.length > 0) return NextResponse.json({ deleted: id });
  }

  return NextResponse.json({ deleted: id });
}
