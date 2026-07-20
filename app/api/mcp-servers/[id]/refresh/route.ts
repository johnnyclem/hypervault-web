import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { resolveServerAuth } from "@/lib/smallchat/mcp-auth";
import { introspectMcpServer } from "@/lib/smallchat/introspect";
import { withVaultColumns } from "@/lib/smallchat/server-rows";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingToolkitsTableHint } from "@/lib/supabase/errors";

export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data: server, error: lookupError } = await admin
    .from("mcp_servers")
    .select(
      await withVaultColumns("id, user_id, url, auth_headers_cipher, oauth_grant_cipher, disabled_tools", admin)
    )
    .eq("id", id)
    .eq("user_id", auth.identity.userId)
    .maybeSingle()
    .returns<{
      id: string;
      user_id: string;
      url: string;
      auth_headers_cipher: string | null;
      oauth_grant_cipher: string | null;
      auth_headers_secret_id?: string | null;
      oauth_grant_secret_id?: string | null;
      disabled_tools: string[] | null;
    }>();
  if (lookupError) {
    const hint = missingToolkitsTableHint(lookupError);
    if (hint) return NextResponse.json({ error: hint }, { status: 503 });
  }
  if (!server) return NextResponse.json({ error: "Server not found." }, { status: 404 });

  const probe = await introspectMcpServer(server.url, await resolveServerAuth(server, admin));
  if (!probe.ok) {
    if (probe.authRequired) {
      return NextResponse.json(
        { error: "Authorization expired — reconnect this server.", auth_required: true },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: `Could not reach the MCP server: ${probe.error}` }, { status: 502 });
  }

  const known = new Set(probe.tools.map((t) => t.name));
  const disabled = ((server.disabled_tools as string[]) ?? []).filter((t) => known.has(t));
  const introspectedAt = new Date().toISOString();

  const { error } = await admin
    .from("mcp_servers")
    .update({ tools_cache: probe.tools, disabled_tools: disabled, introspected_at: introspectedAt, updated_at: introspectedAt })
    .eq("id", id)
    .eq("user_id", auth.identity.userId);
  if (error) {
    const hint = missingToolkitsTableHint(error);
    return NextResponse.json({ error: hint ?? error.message }, { status: hint ? 503 : 500 });
  }

  return NextResponse.json({ tools: probe.tools, disabled_tools: disabled, introspected_at: introspectedAt });
}
