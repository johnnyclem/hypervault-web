import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiKeysCard, type ApiKeyRow } from "@/components/api-keys-card";
import { JobNotifications } from "@/components/job-notifications";
import { SecretsCard, type SecretRow } from "@/components/secrets-card";
import { JsxImportButton } from "@/components/jsx-import-button";
import { SiteHeader } from "@/components/site-header";
import type { RealmThemeRow } from "@/components/theme-switcher";
import {
  VaultView,
  type VaultArtifact,
  type VaultConnection,
  type VaultMemory,
  type VaultMemoryArtifactLink,
  type VaultMemoryLink,
} from "@/components/vault-view";
import { SharedWithYou, type SharedArtifact } from "@/components/shared-with-you";
import { MAX_PRO_SUBDOMAINS } from "@/lib/domains";
import { getAccess } from "@/lib/access";
import { getDashboardTheme } from "@/lib/dashboard-theme";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { isMissingColumnError } from "@/lib/visibility";

export const metadata = { title: "My Vault" };
export const dynamic = "force-dynamic";

export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { repair, error } = await searchParams;
  const autoRepairSlug = typeof repair === "string" && repair.trim() ? repair.trim() : null;
  const autoRepairError = typeof error === "string" && error.trim() ? error.trim().slice(0, 2000) : null;
  const { user, approved, isAdmin } = await getAccess();
  if (!user) {
    const next = autoRepairSlug
      ? `/vault?repair=${encodeURIComponent(autoRepairSlug)}${autoRepairError ? `&error=${encodeURIComponent(autoRepairError)}` : ""}`
      : null;
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  }
  if (!approved) redirect("/waitlist");

  const supabase = (await createClient())!;

  const ARTIFACT_COLUMNS = "id, slug, title, type, is_jsx, is_pwa, tags, connect_to, source_prompt, created_at";
  async function fetchArtifacts(): Promise<{ data: VaultArtifact[] | null }> {
    const query = (columns: string) =>
      supabase.from("artifacts").select(columns).eq("user_id", user!.id).order("created_at", { ascending: false });
    let res = await query(`${ARTIFACT_COLUMNS}, visibility, icon`);
    if (res.error && isMissingColumnError(res.error, "icon")) {
      res = await query(`${ARTIFACT_COLUMNS}, visibility`);
    }
    if (res.error && isMissingColumnError(res.error, "visibility")) {
      res = await query(ARTIFACT_COLUMNS);
    }
    return { data: res.data as unknown as VaultArtifact[] | null };
  }

  async function fetchSharedWithMe(): Promise<SharedArtifact[]> {
    const admin = createAdminClient();
    if (!admin) return [];
    const { data: shares } = await admin
      .from("artifact_shares")
      .select(
        "id, created_at, artifact:artifacts(slug, title, type, is_jsx), owner:profiles!artifact_shares_owner_id_fkey(email, display_name)"
      )
      .eq("shared_with_id", user!.id)
      .order("created_at", { ascending: false })
      .limit(100);
    return (shares ?? []).flatMap((s) => {
      const artifact = (Array.isArray(s.artifact) ? s.artifact[0] : s.artifact) as {
        slug: string;
        title: string;
        type: string;
        is_jsx: boolean;
      } | null;
      const owner = (Array.isArray(s.owner) ? s.owner[0] : s.owner) as {
        email: string | null;
        display_name: string | null;
      } | null;
      if (!artifact) return [];
      return [
        {
          share_id: s.id as string,
          slug: artifact.slug,
          title: artifact.title,
          type: artifact.type,
          is_jsx: artifact.is_jsx,
          owner: owner?.display_name ?? owner?.email ?? "another user",
          created_at: s.created_at as string,
        },
      ];
    });
  }

  const [
    { data: artifacts },
    { data: connections },
    { data: memories },
    { data: memoryLinks },
    { data: memoryArtifactLinks },
    { data: profile },
    { data: keys },
    { data: secrets },
    { data: claims },
    dashboard,
    sharedWithMe,
  ] =
    await Promise.all([
      fetchArtifacts(),
      supabase.from("connections").select("id, a_id, b_id, kind").eq("user_id", user.id).limit(1000),
      supabase
        .from("memories")
        .select("id, title, source, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("memory_links").select("id, a_id, b_id, kind").eq("user_id", user.id).limit(1000),
      supabase
        .from("memory_artifact_links")
        .select("id, memory_id, artifact_id, kind")
        .eq("user_id", user.id)
        .limit(1000),
      supabase.from("profiles").select("plan, vanity_subdomain").eq("id", user.id).maybeSingle(),
      supabase
        .from("api_keys")
        .select("id, key_prefix, created_at, last_used_at")
        .eq("user_id", user.id)
        .eq("revoked", false)
        .order("created_at", { ascending: false }),
      supabase
        .from("user_secrets")
        .select("id, name, kind, description, created_at, last_accessed_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("domain_claims")
        .select("subdomain, base_domain, theme")
        .eq("user_id", user.id)
        .order("claimed_at", { ascending: true })
        .limit(MAX_PRO_SUBDOMAINS),
      getDashboardTheme(user.id),
      fetchSharedWithMe(),
    ]);

  const themeRealms = (claims ?? []) as RealmThemeRow[];
  if (themeRealms.length === 0 && profile?.vanity_subdomain) {
    themeRealms.push({ subdomain: profile.vanity_subdomain, base_domain: "vault.cool", theme: null });
  }
  const realms = themeRealms.map((c) => `${c.subdomain}.${c.base_domain}`);

  return (
    <div className={cn("min-h-dvh", dashboard.wrapperClass)}>
      <JobNotifications />
      <SiteHeader user={user} isAdmin={isAdmin} />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 pb-24 pt-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Vault</h1>
          <p className="text-sm text-muted-foreground">
            {artifacts?.length ?? 0} artifact{(artifacts?.length ?? 0) === 1 ? "" : "s"} on your flight deck
          </p>
        </div>

        <VaultView
          artifacts={(artifacts ?? []) as VaultArtifact[]}
          connections={(connections ?? []) as VaultConnection[]}
          memories={(memories ?? []) as VaultMemory[]}
          memoryLinks={(memoryLinks ?? []) as VaultMemoryLink[]}
          memoryArtifactLinks={(memoryArtifactLinks ?? []) as VaultMemoryArtifactLink[]}
          realms={realms}
          autoRepairSlug={autoRepairSlug}
          autoRepairError={autoRepairError}
        />

        <SharedWithYou items={sharedWithMe} />

        <Card>
          <CardHeader>
            <CardTitle>Chat &amp; import — any LLM, your memory</CardTitle>
            <CardDescription>
              Bring your ChatGPT, Claude, Gemini, and Grok history home, then continue any thread on
              any backend with your vault as shared memory.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link href="/chat">
              <Button size="sm">Open chat</Button>
            </Link>
            <Link href="/vault/import">
              <Button size="sm" variant="outline">
                Import your AI history
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Import a .jsx artifact</CardTitle>
            <CardDescription>
              Drop a React component file straight in — it's auto-wrapped into a running, installable
              page, the same as pasting it works today.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <JsxImportButton label="Import .jsx file" />
          </CardContent>
        </Card>

        <div className="grid gap-6 sm:grid-cols-2">
          <ApiKeysCard keys={(keys ?? []) as ApiKeyRow[]} />
          <SecretsCard
            secrets={(secrets ?? []) as SecretRow[]}
            apiKeys={(keys ?? []) as { id: string; key_prefix: string }[]}
          />
          <Card>
            <CardHeader>
              <CardTitle>Save from anywhere</CardTitle>
              <CardDescription>Three ways to fill your vault.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                <li>
                  <span className="font-semibold text-foreground">From chat:</span> paste anything with{" "}
                  <Link href="/vault/new" className="text-accent underline underline-offset-4">
                    New from chat
                  </Link>
                </li>
                <li>
                  <span className="font-semibold text-foreground">From agents:</span> run{" "}
                  <code className="font-mono">hypervault-mcp</code> with an API key
                </li>
                <li>
                  <span className="font-semibold text-foreground">From code:</span>{" "}
                  <code className="font-mono">POST /api/save</code>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
