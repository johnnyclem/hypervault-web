import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { clearDeadEndpoint, markDeadEndpoint } from "@/lib/smallchat/dead-endpoints";
import { probeLiveness } from "@/lib/smallchat/liveness";

export const maxDuration = 30;

const MAX_URLS = 12;

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const urls = Array.isArray(body.urls)
    ? Array.from(
        new Set(
          body.urls
            .filter((u): u is string => typeof u === "string" && /^https?:\/\/.+/.test(u.trim()))
            .map((u) => u.trim())
        )
      ).slice(0, MAX_URLS)
    : [];
  if (urls.length === 0) return NextResponse.json({ results: [] });

  const results = await Promise.all(
    urls.map(async (url) => {
      const probe = await probeLiveness(url);
      if (probe.state === "dead") await markDeadEndpoint(url, probe.status ?? 404);
      else if (probe.state === "alive") await clearDeadEndpoint(url);
      return probe;
    })
  );

  return NextResponse.json({ results });
}
