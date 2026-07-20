import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import {
  BRANCH_NAME_RE,
  BranchExistsError,
  createBranch,
  ensureMainBranch,
  getBranchByName,
  listBranches,
} from "@/lib/mind/branches";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }
  const userId = auth.identity.userId;

  try {
    await ensureMainBranch(admin, userId);
    const branches = await listBranches(admin, userId);
    const { data: heads } = await admin.from("memory_heads").select("branch_id").eq("user_id", userId);
    const counts = new Map<string, number>();
    for (const h of heads ?? []) counts.set(h.branch_id, (counts.get(h.branch_id) ?? 0) + 1);

    return NextResponse.json({
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        is_default: b.is_default,
        head_commit_id: b.head_commit_id,
        created_at: b.created_at,
        memory_count: counts.get(b.id) ?? 0,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not list branches." }, { status: 500 });
  }
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

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!BRANCH_NAME_RE.test(name)) {
    return NextResponse.json(
      { error: "Branch names are lowercase letters, digits, and /_- (max 63 chars, must start alphanumeric)." },
      { status: 400 }
    );
  }
  if (name === "main") {
    return NextResponse.json({ error: "main already exists — it's the default branch." }, { status: 409 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }
  const userId = auth.identity.userId;

  try {
    const fromName = typeof body.from === "string" && body.from.trim() ? body.from.trim() : "main";
    const from = fromName === "main" ? await ensureMainBranch(admin, userId) : await getBranchByName(admin, userId, fromName);
    if (!from) {
      return NextResponse.json({ error: `No such branch "${fromName}" to fork from.` }, { status: 404 });
    }

    const branch = await createBranch(admin, userId, name, from);
    return NextResponse.json({
      id: branch.id,
      name: branch.name,
      from: from.name,
      head_commit_id: branch.head_commit_id,
      message: `Branched "${branch.name}" from ${from.name} — edits there won't touch ${from.name} until you merge.`,
    });
  } catch (err) {
    if (err instanceof BranchExistsError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not create the branch." }, { status: 500 });
  }
}
