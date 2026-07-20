import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteRedeemForm } from "@/components/invite-redeem-form";
import { SignOutButton } from "@/components/sign-out-button";
import { getAccess } from "@/lib/access";

export const metadata = { title: "You're on the waitlist" };
export const dynamic = "force-dynamic";

export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { user, approved } = await getAccess();
  if (!user) redirect("/login");
  if (approved) redirect("/vault");
  const { code } = await searchParams;

  return (
    <main className="hv-glow flex min-h-dvh items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>You&apos;re on the list 🎟️</CardTitle>
          <CardDescription>
            HyperVault is invite-only right now. We saved a spot for{" "}
            <span className="font-mono text-foreground">{user.email}</span> and will unlock your
            vault as soon as it&apos;s your turn.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <div className="w-full border-t border-border pt-4">
            <p className="mb-3 text-center text-sm font-semibold">Have an invite code?</p>
            <InviteRedeemForm initialError={code} />
          </div>
          <div className="flex items-center gap-3">
            <SignOutButton />
            <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
              ← Back to home
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
