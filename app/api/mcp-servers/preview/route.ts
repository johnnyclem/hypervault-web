import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { markDeadEndpoint } from "@/lib/smallchat/dead-endpoints";
import { introspectMcpServer } from "@/lib/smallchat/introspect";
import { parseHeaders } from "@/lib/smallchat/server-rows";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

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

  const probe = await introspectMcpServer(url, headers ?? undefined);
  if (!probe.ok) {
    if (probe.authRequired) {
      return NextResponse.json(
        {
          error: "This MCP server requires authorization.",
          auth_required: true,
          url,
          name: typeof body.name === "string" ? body.name.trim().slice(0, 80) || undefined : undefined,
        },
        { status: 401 }
      );
    }
    if (probe.dead) {
      if (!headers) await markDeadEndpoint(url, probe.status ?? 404, probe.error);
      return NextResponse.json(
        { error: `Could not connect to the MCP server: ${probe.error}`, dead: true, status: probe.status },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: `Could not connect to the MCP server: ${probe.error}` }, { status: 502 });
  }

  const name =
    (typeof body.name === "string" && body.name.trim().slice(0, 80)) ||
    probe.serverName ||
    new URL(url).hostname;

  return NextResponse.json({ url, name, serverName: probe.serverName ?? null, tools: probe.tools });
}
