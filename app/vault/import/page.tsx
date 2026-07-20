import Link from "next/link";
import { redirect } from "next/navigation";
import { ImportForm } from "@/components/import-form";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAccess } from "@/lib/access";
import { getDashboardTheme } from "@/lib/dashboard-theme";
import { cn } from "@/lib/utils";

export const metadata = { title: "Import your AI history" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const { user, approved } = await getAccess();
  if (!user) redirect("/login");
  if (!approved) redirect("/waitlist");

  const dashboardTheme = await getDashboardTheme(user.id);

  return (
    <div className={cn("min-h-dvh", dashboardTheme.wrapperClass)}>
      <SiteHeader user={user} />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 pb-24 pt-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Import your AI history</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pull your full history out of any LLM and into your vault — then continue any thread on
            any backend in{" "}
            <Link href="/chat" className="text-accent underline underline-offset-4">
              Chat
            </Link>
            .
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Where to get your export</CardTitle>
            <CardDescription>Every platform ships your data — here&apos;s the door.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
              <li>
                <span className="font-semibold text-foreground">ChatGPT:</span> Settings → Data
                controls → Export data → upload <code className="font-mono">conversations.json</code>
              </li>
              <li>
                <span className="font-semibold text-foreground">Claude:</span> Settings → Privacy →
                Export data → upload <code className="font-mono">conversations.json</code>
              </li>
              <li>
                <span className="font-semibold text-foreground">Gemini:</span> Google Takeout →
                Gemini Apps → upload <code className="font-mono">MyActivity.json</code>
              </li>
              <li>
                <span className="font-semibold text-foreground">Grok:</span> X → Settings → Download
                an archive of your data
              </li>
              <li>
                <span className="font-semibold text-foreground">Anything else:</span> copy the
                conversation and paste it below — speaker labels are enough.
              </li>
            </ul>
          </CardContent>
        </Card>

        <ImportForm />
      </main>
    </div>
  );
}
