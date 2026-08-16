import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { encryptionAvailable, encryptSecret } from "@/lib/backends/crypto";
import { rateLimit } from "@/lib/ratelimit";
import { introspectMcpServer } from "@/lib/smallchat/introspect";
import { parseHeaders, publicServer, serverColumns } from "@/lib/smallchat/server-rows";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingToolkitsTableHint, missingVaultColumnHint } from "@/lib/supabase/errors";

export const maxDuration = 60;

const MAX_SERVERS = 20;

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data, error } = await admin
    .from("mcp_servers")
    .select(await serverColumns(admin))
    .eq("user_id", auth.identity.userId)
    .order("created_at", { ascending: true })
    .returns<Record<string, unknown>[]>();
  if (error) {
    const hint = missingToolkitsTableHint(error) ?? missingVaultColumnHint(error);
    return NextResponse.json({ error: hint ?? error.message }, { status: hint ? 503 : 500 });
  }
  return NextResponse.json({ servers: (data ?? []).map(publicServer) });
}

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limited = rateLimit(`mcp-servers:${auth.identity.userId}`, 20, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Rate limit reached — try again in a minute." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim().replace(/\/$/, "") : "";
  if (!/^https?:\/\/.+/.test(url)) {
    return NextResponse.json({ error: "url must be an absolute http(s) URL." }, { status: 400 });
  }
  const headers = parseHeaders(body.headers);
  if (headers && !encryptionAvailable()) {
    return NextResponse.json(
      { error: "Server-side encryption is not configured (HYPERVAULT_KEY_SECRET) — cannot store auth headers." },
      { status: 503 }
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }
  const userId = auth.identity.userId;

  const { count, error: countError } = await admin
    .from("mcp_servers")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (countError) {
    const hint = missingToolkitsTableHint(countError);
    if (hint) return NextResponse.json({ error: hint }, { status: 503 });
  }
  if ((count ?? 0) >= MAX_SERVERS) {
    return NextResponse.json({ error: `Limit of ${MAX_SERVERS} MCP servers reached.` }, { status: 400 });
  }

  const probe = await introspectMcpServer(url, headers ?? undefined);
  if (!probe.ok) {
    if (probe.authRequired) {
      return NextResponse.json(
        {
          error: "This MCP server requires authorization.",
          auth_required: true,
          url,
          name: typeof body.name === "string" ? body.name.trim().slice(0, 80) || undefined : undefined,
          registry_id: typeof body.registry_id === "string" ? body.registry_id.slice(0, 200) : undefined,
        },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: `Could not connect to the MCP server: ${probe.error}` }, { status: 502 });
  }

  const name =
    (typeof body.name === "string" && body.name.trim().slice(0, 80)) ||
    probe.serverName ||
    new URL(url).hostname;

  const { data: created, error } = await admin
    .from("mcp_servers")
    .insert({
      user_id: userId,
      name,
      url,
      auth_headers_cipher: headers ? encryptSecret(JSON.stringify(headers)) : null,
      tools_cache: probe.tools,
      introspected_at: new Date().toISOString(),
      registry_id: typeof body.registry_id === "string" ? body.registry_id.slice(0, 200) : null,
    })
    .select(await serverColumns(admin))
    .single()
    .returns<Record<string, unknown>>();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "That server is already added." }, { status: 409 });
    }
    const hint = missingToolkitsTableHint(error) ?? missingVaultColumnHint(error);
    return NextResponse.json({ error: hint ?? error.message }, { status: hint ? 503 : 500 });
  }

  return NextResponse.json({
    server: publicServer(created),
    message: `Connected — ${probe.tools.length} tool${probe.tools.length === 1 ? "" : "s"} discovered. Compile to use them in chat.`,
  });
}
