import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { isThemeId, THEMES } from "@/lib/themes";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingThemeColumnHint } from "@/lib/supabase/errors";

export async function PATCH(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const theme = body.theme ?? null;
  if (theme !== null && !isThemeId(theme)) {
    return NextResponse.json(
      { error: `Unknown theme. Pick one of: ${THEMES.map((t) => t.styleId).join(", ")} — or null for the HyperVault default.` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data: updated, error } = await admin
    .from("profiles")
    .update({ theme })
    .eq("id", auth.identity.userId)
    .select("theme")
    .maybeSingle();

  if (error) {
    const hint = missingThemeColumnHint(error);
    return NextResponse.json({ error: hint ?? error.message }, { status: hint ? 503 : 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "No profile found for this account." }, { status: 404 });
  }

  return NextResponse.json({
    theme: updated.theme,
    message: updated.theme
      ? `Your dashboard now wears ${updated.theme}. ✨`
      : "Your dashboard is back on the stock HyperVault look.",
  });
}
