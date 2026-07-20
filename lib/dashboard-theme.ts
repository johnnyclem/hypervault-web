import { createClient } from "@/lib/supabase/server";
import { themeById } from "@/lib/themes";

export type DashboardTheme = {
  themeId: string | null;
  wrapperClass: string | null;
};

export function dashboardWrapperClass(themeId: string | null | undefined): string | null {
  const theme = themeById(themeId);
  return theme ? `${theme.className} lp` : null;
}

export async function getDashboardTheme(userId: string): Promise<DashboardTheme> {
  const supabase = await createClient();
  if (!supabase) return { themeId: null, wrapperClass: null };
  const { data } = await supabase.from("profiles").select("theme").eq("id", userId).maybeSingle();
  const themeId = (data?.theme as string | null) ?? null;
  return { themeId, wrapperClass: dashboardWrapperClass(themeId) };
}
