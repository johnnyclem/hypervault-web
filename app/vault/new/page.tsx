import Link from "next/link";
import { redirect } from "next/navigation";
import { NewArtifactForm } from "@/components/new-artifact-form";
import { SiteHeader } from "@/components/site-header";
import { getAccess } from "@/lib/access";
import { getDashboardTheme } from "@/lib/dashboard-theme";
import { cn } from "@/lib/utils";

export const metadata = { title: "New from chat" };
export const dynamic = "force-dynamic";

export default async function NewArtifactPage() {
  const { user, approved } = await getAccess();
  if (!user) redirect("/login");
  if (!approved) redirect("/waitlist");

  const dashboardTheme = await getDashboardTheme(user.id);

  return (
    <div className={cn("min-h-dvh", dashboardTheme.wrapperClass)}>
      <SiteHeader user={user} />
      <main className="mx-auto w-full max-w-2xl px-6 pb-24 pt-6">
        <Link href="/vault" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to vault
        </Link>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">New from chat</h1>
        <p className="mb-8 mt-1 text-sm text-muted-foreground">
          Paste anything your AI created. If it&apos;s a React/JSX component (looking at you, Gemini), we&apos;ll
          detect it and wrap it into a working page automatically.
        </p>
        <NewArtifactForm />
      </main>
    </div>
  );
}
