import { DomainLanding } from "@/components/landing/domain-landing";
import { DEFAULT_THEME } from "@/lib/themes";
import { getUser } from "@/lib/supabase/server";

export default async function HomePage() {
  const user = await getUser();

  return <DomainLanding domain="vault.cool" brand="HyperVault" theme={DEFAULT_THEME} user={user} />;
}
