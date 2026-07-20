import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { describeEmbedder, type EmbedderIdentity } from "@/lib/smallchat/embedder";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingToolkitsTableHint } from "@/lib/supabase/errors";

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }
  const userId = auth.identity.userId;

  const { data: toolkit, error } = await admin
    .from("toolkits")
    .select("id, stats, embedder, compiled_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    const hint = missingToolkitsTableHint(error);
    if (hint) return NextResponse.json({ error: hint }, { status: 503 });
  }
  if (!toolkit) return NextResponse.json({ toolkit: null, stale: false });

  const { data: servers } = await admin
    .from("mcp_servers")
    .select("updated_at")
    .eq("user_id", userId)
    .eq("enabled", true)
    .gt("updated_at", toolkit.compiled_at)
    .limit(1);

  const identity = toolkit.embedder as EmbedderIdentity;
  return NextResponse.json({
    toolkit: {
      id: toolkit.id,
      stats: toolkit.stats,
      embedder: identity,
      embedder_label: describeEmbedder(identity),
      compiled_at: toolkit.compiled_at,
    },
    stale: (servers ?? []).length > 0,
  });
}
