import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { BranchInUseError, deleteBranch, getBranchByName } from "@/lib/mind/branches";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { name } = await params;
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }
  const userId = auth.identity.userId;

  const branch = await getBranchByName(admin, userId, decodeURIComponent(name));
  if (!branch) return NextResponse.json({ error: "No such branch." }, { status: 404 });
  if (branch.is_default) {
    return NextResponse.json({ error: "The default branch cannot be deleted." }, { status: 400 });
  }

  try {
    await deleteBranch(admin, userId, branch);
  } catch (err) {
    if (err instanceof BranchInUseError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not delete the branch." }, { status: 500 });
  }

  return NextResponse.json({ deleted: branch.name, message: `Branch "${branch.name}" is gone.` });
}
