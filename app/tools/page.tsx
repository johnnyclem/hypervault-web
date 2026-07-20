import { redirect } from "next/navigation";
import { ToolsConsole } from "@/components/tools/tools-console";
import type { ServerRow, ToolkitSummary } from "@/components/tools/types";
import { SiteHeader } from "@/components/site-header";
import { getAccess } from "@/lib/access";
import { getDashboardTheme } from "@/lib/dashboard-theme";
import { describeEmbedder, type EmbedderIdentity } from "@/lib/smallchat/embedder";
import { suggestedServers } from "@/lib/smallchat/registry-search";
import { publicServer, serverColumns } from "@/lib/smallchat/server-rows";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = { title: "Tools" };
export const dynamic = "force-dynamic";

export default async function ToolsPage() {
  const { user, approved } = await getAccess();
  if (!user) redirect("/login");
  if (!approved) redirect("/waitlist");

  const supabase = (await createClient())!;
  const serverCols = await serverColumns(supabase);
  const [serversRes, toolkitRes, dashboardTheme] = await Promise.all([
    supabase
      .from("mcp_servers")
      .select(serverCols)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .returns<Record<string, unknown>[]>(),
    supabase
      .from("toolkits")
      .select("id, stats, embedder, compiled_at")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle(),
    getDashboardTheme(user.id),
  ]);

  const servers: ServerRow[] = (serversRes.data ?? []).map(
    (row) => publicServer(row as Record<string, unknown>) as unknown as ServerRow
  );

  let toolkit: ToolkitSummary | null = null;
  let stale = false;
  if (toolkitRes.data) {
    const identity = toolkitRes.data.embedder as EmbedderIdentity;
    toolkit = {
      id: toolkitRes.data.id,
      stats: toolkitRes.data.stats as ToolkitSummary["stats"],
      embedder_label: describeEmbedder(identity),
      compiled_at: toolkitRes.data.compiled_at,
    };
    const { data: changed } = await supabase
      .from("mcp_servers")
      .select("id")
      .eq("user_id", user.id)
      .eq("enabled", true)
      .gt("updated_at", toolkitRes.data.compiled_at)
      .limit(1);
    stale = (changed ?? []).length > 0;
  }

  return (
    <div className={cn("flex min-h-dvh flex-col", dashboardTheme.wrapperClass)}>
      <SiteHeader user={user} />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 pb-6 md:px-6 md:pb-10">
        <div className="pt-2">
          <h1 className="text-xl font-semibold">Tools</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect MCP servers, choose which tools are live, then compile them into a toolkit. Chat
            dispatches your intents to the right tool semantically — no tool lists stuffed into
            context.
          </p>
        </div>
        <ToolsConsole
          initialServers={servers}
          initialToolkit={toolkit}
          initialStale={stale}
          suggested={suggestedServers()}
        />
      </main>
    </div>
  );
}
