import Link from "next/link";
import { redirect } from "next/navigation";
import { BranchSwitcher, type BranchInfo } from "@/components/branch-switcher";
import { Button } from "@/components/ui/button";
import {
  MemoryPanel,
  type ArtifactOption,
  type ChatBackend,
  type MemoryArtifactLinkRow,
  type MemoryLinkRow,
  type MemoryListItem,
} from "@/components/memory-panel";
import type { DigestRunView, DigestSegmentView } from "@/components/digest-review";
import { SiteHeader } from "@/components/site-header";
import { getAccess } from "@/lib/access";
import { loadChatContextSettings } from "@/lib/chat/settings";
import { getDashboardTheme } from "@/lib/dashboard-theme";
import { internalLinks, type DigestStrategy } from "@/lib/digestion";
import { isStenographerConfigured } from "@/lib/stenographer/client";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = { title: "Memory Control Panel" };
export const dynamic = "force-dynamic";

type CommitStripEntry = {
  id: string;
  message: string;
  author_kind: string;
  created_at: string;
};

type DigestRunRow = {
  id: string;
  source_memory_id: string;
  source_title: string;
  strategy: DigestStrategy;
  created_at: string;
};

type DigestSegmentRow = {
  run_id: string;
  ordinal: number;
  title: string;
  summary: string;
  tags: string[] | null;
  reason: string;
};

export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; open?: string; mode?: string }>;
}) {
  const { user, approved } = await getAccess();
  if (!user) redirect("/login");
  if (!approved) redirect("/waitlist");

  const { branch: branchParam, open, mode: modeParam } = await searchParams;
  const branchName = branchParam?.trim() || "main";
  const initialMode =
    modeParam === "digest" || modeParam === "ask" || modeParam === "graph" ? modeParam : "search";

  const supabase = (await createClient())!;

  const [{ data: branchRows }, dashboardTheme] = await Promise.all([
    supabase
      .from("memory_branches")
      .select("id, name, is_default, head_commit_id")
      .eq("user_id", user.id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true }),
    getDashboardTheme(user.id),
  ]);
  const branches = branchRows ?? [];
  const current = branches.find((b) => b.name === branchName);
  if (branchName !== "main" && !current) redirect("/vault/memory");

  let memories: MemoryListItem[] = [];
  let links: MemoryLinkRow[] = [];

  if (!current || current.is_default) {
    const [{ data: memoryRows }, linkQuery] = await Promise.all([
      supabase
        .from("memories")
        .select("id, title, summary, tags, source, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200),
      current
        ? supabase
            .from("memory_links")
            .select("id, a_id, b_id, kind")
            .eq("user_id", user.id)
            .eq("branch_id", current.id)
            .limit(1000)
        : supabase.from("memory_links").select("id, a_id, b_id, kind").eq("user_id", user.id).limit(1000),
    ]);
    memories = (memoryRows ?? []) as MemoryListItem[];
    links = (linkQuery.data ?? []) as MemoryLinkRow[];
  } else {
    const [{ data: stateRows }, { data: linkRows }] = await Promise.all([
      supabase.rpc("mind_branch_state", { p_user: user.id, p_branch: current.id, p_q: null }),
      supabase
        .from("memory_links")
        .select("id, a_id, b_id, kind")
        .eq("user_id", user.id)
        .eq("branch_id", current.id)
        .limit(1000),
    ]);
    memories = ((stateRows ?? []) as {
      memory_id: string;
      title: string;
      summary: string;
      tags: string[];
      source: string;
      committed_at: string;
    }[])
      .map((r) => ({
        id: r.memory_id,
        title: r.title,
        summary: r.summary,
        tags: r.tags,
        source: r.source,
        created_at: r.committed_at,
      }))
      .sort((x, y) => (y.created_at < x.created_at ? -1 : 1));
    links = (linkRows ?? []) as MemoryLinkRow[];
  }

  const [
    { data: artifactRows },
    { data: artifactLinkRows },
    { data: backendRows },
    chatContextSettings,
    toolkitRes,
  ] = await Promise.all([
    supabase
      .from("artifacts")
      .select("id, slug, title, type")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("memory_artifact_links")
      .select("id, memory_id, artifact_id, kind")
      .eq("user_id", user.id)
      .limit(1000),
    supabase
      .from("llm_backends")
      .select("id, name, default_model")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    loadChatContextSettings(supabase, user.id),
    supabase.from("toolkits").select("id").eq("user_id", user.id).eq("is_active", true).maybeSingle(),
  ]);

  const { data: headRows } = await supabase.from("memory_heads").select("branch_id").eq("user_id", user.id);
  const headCounts = new Map<string, number>();
  for (const h of headRows ?? []) headCounts.set(h.branch_id, (headCounts.get(h.branch_id) ?? 0) + 1);

  const branchInfos: BranchInfo[] =
    branches.length > 0
      ? branches.map((b) => ({
          name: b.name,
          is_default: b.is_default,
          memory_count: b.is_default && !b.head_commit_id ? memories.length : (headCounts.get(b.id) ?? 0),
        }))
      : [{ name: "main", is_default: true, memory_count: memories.length }];

  let commits: CommitStripEntry[] = [];
  if (current) {
    const { data: commitRows } = await supabase
      .from("memory_commits")
      .select("id, message, author_kind, created_at")
      .eq("user_id", user.id)
      .eq("branch_id", current.id)
      .order("created_at", { ascending: false })
      .limit(5);
    commits = (commitRows ?? []) as CommitStripEntry[];
  }

  const { data: digestProfile } = await supabase
    .from("profiles")
    .select("digestion_enabled")
    .eq("id", user.id)
    .maybeSingle();
  const { data: digestRunRows } = await supabase
    .from("digest_runs")
    .select("id, source_memory_id, source_title, strategy, created_at")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);
  const digestRunIds = (digestRunRows ?? []).map((r) => r.id);
  let digestSegRows: DigestSegmentRow[] = [];
  if (digestRunIds.length > 0) {
    const { data } = await supabase
      .from("digest_segments")
      .select("run_id, ordinal, title, summary, tags, reason")
      .eq("user_id", user.id)
      .in("run_id", digestRunIds)
      .order("ordinal", { ascending: true });
    digestSegRows = (data ?? []) as DigestSegmentRow[];
  }
  const digestSegsByRun = new Map<string, DigestSegmentRow[]>();
  for (const s of digestSegRows) {
    const list = digestSegsByRun.get(s.run_id) ?? [];
    list.push(s);
    digestSegsByRun.set(s.run_id, list);
  }
  const digestRuns: DigestRunView[] = ((digestRunRows ?? []) as DigestRunRow[])
    .map((r) => {
      const segs = digestSegsByRun.get(r.id) ?? [];
      const segments: DigestSegmentView[] = segs.map((s) => ({
        ordinal: s.ordinal,
        title: s.title,
        summary: s.summary,
        tags: s.tags ?? [],
        reason: s.reason,
      }));
      const digestLinks = internalLinks(segments.map((s) => ({ ...s, content: "" })));
      return {
        id: r.id,
        source_memory_id: r.source_memory_id,
        source_title: r.source_title,
        strategy: r.strategy,
        created_at: r.created_at,
        segments,
        links: digestLinks,
      };
    })
    .filter((r) => r.segments.length > 0);

  return (
    <div className={cn("min-h-dvh", dashboardTheme.wrapperClass)}>
      <SiteHeader user={user} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pb-24 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Memory Control Panel</h1>
            <p className="text-sm text-muted-foreground">
              Your private LLM-wiki — versioned like git. Every change is a commit; branch, merge, and
              time-travel your mind. Only you can read it.
            </p>
          </div>
          <Link href="/vault">
            <Button variant="outline" size="sm">
              ← My Vault
            </Button>
          </Link>
        </div>

        <BranchSwitcher branches={branchInfos} current={branchName} />

        {commits.length > 0 && (
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-muted/40 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Latest commits on {branchName}
            </p>
            <ul className="flex flex-col gap-0.5">
              {commits.map((c) => (
                <li key={c.id} className="flex items-baseline gap-2 text-xs">
                  <span className="shrink-0 font-mono text-muted-foreground">{c.id.slice(0, 8)}</span>
                  <span className="truncate">{c.message}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <MemoryPanel
          memories={memories}
          links={links}
          branch={branchName}
          artifacts={(artifactRows ?? []) as ArtifactOption[]}
          artifactLinks={(artifactLinkRows ?? []) as MemoryArtifactLinkRow[]}
          backends={(backendRows ?? []) as ChatBackend[]}
          initialOpenId={open ?? null}
          initialMode={initialMode}
          digestEnabled={digestProfile?.digestion_enabled ?? false}
          digestRuns={digestRuns}
          chatContextSettings={chatContextSettings}
          stenographerConfigured={isStenographerConfigured()}
          hasToolkit={Boolean(toolkitRes.data)}
        />
      </main>
    </div>
  );
}
