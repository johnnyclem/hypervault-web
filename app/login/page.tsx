import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { JoinFlow } from "@/components/join-flow";
import { getUser } from "@/lib/supabase/server";

export const metadata = { title: "Join HyperVault" };
export const dynamic = "force-dynamic";

function safeNext(next: string | undefined): string | undefined {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;
}

const REASON_MESSAGES: Record<string, string> = {
  verifier:
    "A stale sign-in cookie was blocking the final step — it's been cleared automatically. Try once more; it should work now.",
  exchange:
    "Google signed you in, but the final handshake failed. Your sign-in state was reset — try again.",
  provider: "Google didn't complete the sign-in (it may have been cancelled). Try again.",
  nocode: "The sign-in link was missing its code — start again from here.",
  config: "The server isn't fully configured for sign-in yet. If this persists, contact the site owner.",
};

const ERROR_MESSAGES: Record<string, string> = {
  auth: "Sign-in didn't complete — try again.",
  retry:
    "Your Google sign-in worked, but we hit a temporary hiccup on our side. Just try again — no need to change anything.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; error?: string; reason?: string; next?: string }>;
}) {
  const { invite, error, reason, next: rawNext } = await searchParams;
  const next = safeNext(rawNext);
  const inviteCode = invite && invite !== "1" ? invite : undefined;

  const user = await getUser();
  if (user) redirect(next ?? "/vault");

  return (
    <main className="hv-glow flex min-h-dvh items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Welcome to HyperVault</CardTitle>
          <CardDescription>No passwords, ever — just your Google account.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {error && error !== "no_account" && (
            <p className="text-center text-xs text-destructive">
              {(reason && REASON_MESSAGES[reason]) || ERROR_MESSAGES[error] || ERROR_MESSAGES.auth}
            </p>
          )}
          {error === "no_account" && (
            <p className="text-center text-xs text-destructive">
              We couldn&apos;t find an account for that Google login — sign up to join the
              waitlist, or use an invite code.
            </p>
          )}
          <JoinFlow showInvite={Boolean(invite)} initialCode={inviteCode} next={next} />
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
            ← Back to home
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
