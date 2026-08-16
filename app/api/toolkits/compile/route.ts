import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { rateLimit } from "@/lib/ratelimit";
import { CompileError, compileToolkit } from "@/lib/smallchat/compile";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limited = rateLimit(`toolkits-compile:${auth.identity.userId}`, 10, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Rate limit reached — try again in a minute." }, { status: 429 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }
  const userId = auth.identity.userId;

  if (Array.isArray(body.servers)) {
    for (const entry of body.servers) {
      if (!entry || typeof entry !== "object") continue;
      const { id, enabled, disabled_tools } = entry as Record<string, unknown>;
      if (typeof id !== "string") continue;
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof enabled === "boolean") patch.enabled = enabled;
      if (Array.isArray(disabled_tools)) {
        patch.disabled_tools = disabled_tools.filter((t) => typeof t === "string").slice(0, 500);
      }
      await admin.from("mcp_servers").update(patch).eq("id", id).eq("user_id", userId);
    }
  }

  try {
    const outcome = await compileToolkit(admin, userId);
    return NextResponse.json(outcome);
  } catch (err) {
    if (err instanceof CompileError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.code === "all_servers_unreachable" ? 502 : 422 }
      );
    }
    return NextResponse.json(
      { error: "compile_failed", message: err instanceof Error ? err.message : "Compilation failed." },
      { status: 500 }
    );
  }
}
