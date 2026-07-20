import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { getDeadEndpoints } from "@/lib/smallchat/dead-endpoints";
import { annotateDeadServers, searchRegistry, suggestedServers } from "@/lib/smallchat/registry-search";

export async function GET(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const servers = await searchRegistry(q.slice(0, 200));
  const dead = await getDeadEndpoints(servers.map((s) => s.url));
  return NextResponse.json({
    servers: annotateDeadServers(servers, dead),
    suggested: suggestedServers(),
  });
}
