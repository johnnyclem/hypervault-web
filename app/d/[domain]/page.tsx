import { notFound } from "next/navigation";
import { DomainLanding } from "@/components/landing/domain-landing";
import { activeBaseDomains } from "@/lib/domains";
import { themeForDomain } from "@/lib/themes";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ domain: string }> };

async function resolveDomain(params: Props["params"]): Promise<string | null> {
  const { domain } = await params;
  const normalized = decodeURIComponent(domain).toLowerCase();
  return activeBaseDomains().includes(normalized) ? normalized : null;
}

export async function generateMetadata({ params }: Props) {
  const domain = await resolveDomain(params);
  if (!domain) return {};
  return {
    title: `${domain} — a place to store your AI stuff`,
    description: `Claim your address at you.${domain} and give everything your AI makes a permanent home.`,
    openGraph: {
      title: domain,
      description: `Claim your address at you.${domain} — part of HyperVault.`,
    },
  };
}

export default async function DomainLandingPage({ params }: Props) {
  const domain = await resolveDomain(params);
  if (!domain) notFound();
  const user = await getUser();
  return <DomainLanding domain={domain} theme={themeForDomain(domain)} user={user} />;
}
