import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import {
  AdminDashboard,
  type AdminAccount,
  type AdminInvite,
  type AdminWaitlistEntry,
} from "@/components/admin/admin-dashboard";
import { getAccess } from "@/lib/access";
import { getDashboardTheme } from "@/lib/dashboard-theme";
import { INVITE_MIGRATION_HINT, isMissingInviteTable } from "@/lib/invite-schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { user, isAdmin } = await getAccess();
  if (!user) redirect("/login");
  if (!isAdmin) redirect("/vault");

  const dashboardTheme = await getDashboardTheme(user.id);

  const admin = createAdminClient();
  if (!admin) {
    return (
      <div className={cn("min-h-dvh", dashboardTheme.wrapperClass)}>
        <SiteHeader user={user} isAdmin />
        <main className="mx-auto w-full max-w-3xl px-6 py-16 text-center text-sm text-muted-foreground">
          The admin dashboard needs SUPABASE_SERVICE_ROLE_KEY set on the server.
        </main>
      </div>
    );
  }

  const [invitesRes, waitlistRes, profilesRes, accessRes, stargazersRes] = await Promise.all([
    admin
      .from("invite_codes")
      .select("id, code, note, max_uses, use_count, disabled, created_at")
      .order("created_at", { ascending: false }),
    admin
      .from("waitlist")
      .select("user_id, email, created_at")
      .order("created_at", { ascending: true }),
    admin
      .from("profiles")
      .select("id, email, display_name, plan, vanity_subdomain, created_at")
      .order("created_at", { ascending: false }),
    admin.from("account_access").select("user_id, source"),
    admin
      .from("github_stargazers")
      .select("github_login, email, unsubscribed, invites_sent, last_invited_at")
      .order("starred_at", { ascending: false }),
  ]);
  const { data: invites } = invitesRes;
  const { data: waitlist } = waitlistRes;
  const { data: profiles } = profilesRes;
  const { data: access } = accessRes;
  const stargazers = (stargazersRes.error ? [] : stargazersRes.data ?? []) as Array<{
    github_login: string;
    email: string | null;
    unsubscribed: boolean;
    invites_sent: number;
    last_invited_at: string | null;
  }>;
  const starReachable = stargazers.filter((s) => !s.unsubscribed && s.email).length;

  const schemaMissing = [invitesRes.error, waitlistRes.error, accessRes.error].some(isMissingInviteTable);
  const queryErrors = [invitesRes.error, waitlistRes.error, profilesRes.error, accessRes.error]
    .filter((e): e is NonNullable<typeof e> => Boolean(e) && !isMissingInviteTable(e))
    .map((e) => e.message);

  const accessByUser = new Map((access ?? []).map((a) => [a.user_id, a.source as string]));
  const accounts: AdminAccount[] = (profiles ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    displayName: p.display_name,
    plan: p.plan,
    vanitySubdomain: p.vanity_subdomain,
    createdAt: p.created_at,
    accessSource: accessByUser.get(p.id) ?? null,
  }));

  return (
    <div className={cn("min-h-dvh", dashboardTheme.wrapperClass)}>
      <SiteHeader user={user} isAdmin />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 pb-24 pt-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground">
            Invite codes, the waitlist, and every account — signed in as {user.email}.
          </p>
        </div>
        {schemaMissing && (
          <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
            <strong>Database setup needed:</strong> {INVITE_MIGRATION_HINT} Until then, invite codes
            and the waitlist won&apos;t work.
          </p>
        )}
        {queryErrors.map((message) => (
          <p
            key={message}
            className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          >
            {message}
          </p>
        ))}
        <AdminDashboard
          invites={(invites ?? []) as AdminInvite[]}
          waitlist={(waitlist ?? []) as AdminWaitlistEntry[]}
          accounts={accounts}
          adminUserId={user.id}
        />
        <section className="rounded-2xl border bg-card/50 p-5">
          <h2 className="text-lg font-semibold">GitHub star invites</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Stargazers of the repo get a fresh invite code emailed every Monday.{" "}
            <strong className="text-foreground">{stargazers.length}</strong> stargazer
            {stargazers.length === 1 ? "" : "s"} tracked · <strong className="text-foreground">{starReachable}</strong> reachable by email.
          </p>
          {stargazers.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-4 font-medium">GitHub</th>
                    <th className="py-1 pr-4 font-medium">Email</th>
                    <th className="py-1 pr-4 font-medium">Invites sent</th>
                    <th className="py-1 font-medium">Last invited</th>
                  </tr>
                </thead>
                <tbody>
                  {stargazers.slice(0, 50).map((s) => (
                    <tr key={s.github_login} className="border-t">
                      <td className="py-1.5 pr-4">@{s.github_login}</td>
                      <td className="py-1.5 pr-4 text-muted-foreground">
                        {s.unsubscribed ? "unsubscribed" : s.email ?? "—"}
                      </td>
                      <td className="py-1.5 pr-4">{s.invites_sent}</td>
                      <td className="py-1.5 text-muted-foreground">
                        {s.last_invited_at ? new Date(s.last_invited_at).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
