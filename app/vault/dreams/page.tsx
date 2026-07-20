import Link from "next/link";
import { redirect } from "next/navigation";
import { DreamsReview, type DreamConnectionView, type DreamEndpoint, type DreamRunView } from "@/components/dreams-review";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { getAccess } from "@/lib/access";
import { getDashboardTheme } from "@/lib/dashboard-theme";
import type { DreamEdgeType } from "@/lib/dreaming";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dreams" };
export const dynamic = "force-dynamic";

type DreamConnRow = {
  id: string;
  run_id: string;
  edge_type: DreamEdgeType;
  a_id: string;
  b_id: string;
  score: number;
  reason: string;
};

export default async function DreamsPage() {
  const { user, approved } = await getAccess();
  if (!user) redirect("/login");
  if (!approved) redirect("/waitlist");

  const supabase = (await createClient())!;

  const [{ data: profile }, dashboardTheme] = await Promise.all([
    supabase.from("profiles").select("dreaming_enabled, dreaming_last_run_at").eq("id", user.id).maybeSingle(),
    getDashboardTheme(user.id),
  ]);

  const { data: runRows } = await supabase
    .from("dream_runs")
    .select("id, created_at")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);

  const runIds = (runRows ?? []).map((r) => r.id);
  let conns: DreamConnRow[] = [];
  if (runIds.length > 0) {
    const { data } = await supabase
      .from("dream_connections")
      .select("id, run_id, edge_type, a_id, b_id, score, reason")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .in("run_id", runIds)
      .order("score", { ascending: false });
    conns = (data ?? []) as DreamConnRow[];
  }

  const [{ data: artifacts }, { data: memories }] = await Promise.all([
    supabase.from("artifacts").select("id, slug, title").eq("user_id", user.id).limit(2000),
    supabase.from("memories").select("id, title").eq("user_id", user.id).limit(2000),
  ]);
  const artifactById = new Map((artifacts ?? []).map((a) => [a.id, a]));
  const memoryById = new Map((memories ?? []).map((m) => [m.id, m]));

  const artifactEndpoint = (id: string): DreamEndpoint => {
    const a = artifactById.get(id);
    return { kind: "artifact", id, label: a?.title ?? "(deleted artifact)", slug: a?.slug };
  };
  const memoryEndpoint = (id: string): DreamEndpoint => {
    const m = memoryById.get(id);
    return { kind: "memory", id, label: m?.title ?? "(deleted memory)" };
  };
  const shape = (c: DreamConnRow): DreamConnectionView => {
    const a = c.edge_type === "artifact_artifact" ? artifactEndpoint(c.a_id) : memoryEndpoint(c.a_id);
    const b = c.edge_type === "memory_memory" ? memoryEndpoint(c.b_id) : artifactEndpoint(c.b_id);
    return { id: c.id, edge_type: c.edge_type, score: c.score, reason: c.reason, a, b };
  };

  const byRun = new Map<string, DreamConnectionView[]>();
  for (const c of conns) {
    const list = byRun.get(c.run_id) ?? [];
    list.push(shape(c));
    byRun.set(c.run_id, list);
  }
  const runs: DreamRunView[] = (runRows ?? [])
    .map((r) => ({ id: r.id, created_at: r.created_at, connections: byRun.get(r.id) ?? [] }))
    .filter((r) => r.connections.length > 0);

  return (
    <div className={cn("min-h-dvh", dashboardTheme.wrapperClass)}>
      <SiteHeader user={user} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pb-24 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dreams</h1>
            <p className="text-sm text-muted-foreground">
              Connections HyperVault dreamt up while you were away — review and merge the ones that fit.
            </p>
          </div>
          <Link href="/vault">
            <Button variant="outline" size="sm">
              ← My Vault
            </Button>
          </Link>
        </div>

        <DreamsReview
          initialEnabled={profile?.dreaming_enabled ?? false}
          lastRunAt={profile?.dreaming_last_run_at ?? null}
          runs={runs}
        />
      </main>
    </div>
  );
}
