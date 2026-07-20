import { DomainLanding } from "@/components/landing/domain-landing";
import { themeForDomain } from "@/lib/themes";
import { getUser } from "@/lib/supabase/server";

export const metadata = {
  title: "vault.cool — the coolest address your AI stuff will ever have",
  description: "Claim your .cool address and give everything your AI creates a home worth showing off.",
  openGraph: {
    title: "vault.cool",
    description: "Claim your .cool address — part of HyperVault.",
  },
};

export default async function CoolLandingPage() {
  const user = await getUser();
  return <DomainLanding domain="vault.cool" theme={themeForDomain("vault.cool")} user={user} />;
}
