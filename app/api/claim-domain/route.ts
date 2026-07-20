import { NextResponse, type NextRequest } from "next/server";
import { resolveApiIdentity } from "@/lib/api-auth";
import { activeBaseDomains, MAX_PRO_SUBDOMAINS, validateSubdomain } from "@/lib/domains";
import { isThemeId, THEMES } from "@/lib/themes";
import { rateLimit } from "@/lib/ratelimit";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingThemeColumnHint } from "@/lib/supabase/errors";

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = rateLimit(`availability:${ip}`, 30, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Slow down a little — try again in a minute." }, { status: 429 });
  }

  const name = req.nextUrl.searchParams.get("name") ?? "";
  const base = (req.nextUrl.searchParams.get("base") ?? "vault.cool").trim().toLowerCase();

  if (!activeBaseDomains().includes(base)) {
    return NextResponse.json({ available: false, reason: `${base} isn't claimable yet.` });
  }
  const validation = validateSubdomain(name);
  if (!validation.ok) {
    return NextResponse.json({ available: false, reason: validation.error });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data: existing } = await admin
    .from("domain_claims")
    .select("id")
    .eq("subdomain", validation.name)
    .eq("base_domain", base)
    .maybeSingle();

  return NextResponse.json(
    existing
      ? { available: false, reason: `${validation.name}.${base} is already taken.` }
      : { available: true }
  );
}

export async function POST(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const desired = typeof body.desired_name === "string" ? body.desired_name : "";
  const baseDomain = (typeof body.base_domain === "string" && body.base_domain.trim().toLowerCase()) || "vault.cool";

  if (!activeBaseDomains().includes(baseDomain)) {
    return NextResponse.json(
      { error: `"${baseDomain}" isn't claimable yet. Available today: ${activeBaseDomains().join(", ")}.` },
      { status: 400 }
    );
  }

  const validation = validateSubdomain(desired);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  const name = validation.name;

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data: existing } = await admin
    .from("domain_claims")
    .select("id, user_id")
    .eq("subdomain", name)
    .eq("base_domain", baseDomain)
    .maybeSingle();

  if (existing && existing.user_id !== auth.identity.userId) {
    return NextResponse.json(
      { error: `${name}.${baseDomain} is already taken — so close! Try a variation.` },
      { status: 409 }
    );
  }

  const { count: claimCount } = await admin
    .from("domain_claims")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.identity.userId);
  const ownedClaims = claimCount ?? 0;

  if (!existing) {
    if (ownedClaims >= MAX_PRO_SUBDOMAINS) {
      return NextResponse.json(
        {
          error: `Pro accounts can hold up to ${MAX_PRO_SUBDOMAINS} subdomains, and you've claimed them all. Release one from your vault to make room.`,
        },
        { status: 403 }
      );
    }
    const { error: claimError } = await admin.from("domain_claims").insert({
      user_id: auth.identity.userId,
      subdomain: name,
      base_domain: baseDomain,
    });
    if (claimError) {
      const taken = claimError.code === "23505";
      return NextResponse.json(
        { error: taken ? `${name}.${baseDomain} was just snapped up — try another.` : claimError.message },
        { status: taken ? 409 : 500 }
      );
    }
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("vanity_subdomain")
    .eq("id", auth.identity.userId)
    .maybeSingle();

  const { error: profileError } = await admin
    .from("profiles")
    .update({ vanity_subdomain: profile?.vanity_subdomain ?? name, plan: "pro" })
    .eq("id", auth.identity.userId);

  if (profileError) {
    return NextResponse.json({ error: `Claimed, but profile update failed: ${profileError.message}` }, { status: 500 });
  }

  const claimed = existing ? ownedClaims : ownedClaims + 1;
  return NextResponse.json({
    domain: `${name}.${baseDomain}`,
    url: `https://${name}.${baseDomain}`,
    claimed,
    max_subdomains: MAX_PRO_SUBDOMAINS,
    message: `${name}.${baseDomain} is yours, effective immediately. Welcome to Pro! 🎉 (${claimed}/${MAX_PRO_SUBDOMAINS} subdomains claimed — your whole vault lives on every one.)`,
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await resolveApiIdentity(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const validation = validateSubdomain(typeof body.subdomain === "string" ? body.subdomain : "");
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  const baseDomain =
    (typeof body.base_domain === "string" && body.base_domain.trim().toLowerCase()) || "vault.cool";

  const theme = body.theme ?? null;
  if (theme !== null && !isThemeId(theme)) {
    return NextResponse.json(
      { error: `Unknown theme. Pick one of: ${THEMES.map((t) => t.styleId).join(", ")} — or null for the domain default.` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured with Supabase credentials." }, { status: 503 });
  }

  const { data: existing, error } = await admin
    .from("domain_claims")
    .update({ theme })
    .eq("user_id", auth.identity.userId)
    .eq("subdomain", validation.name)
    .eq("base_domain", baseDomain)
    .select("subdomain, base_domain, theme")
    .maybeSingle();

  if (error) {
    const hint = missingThemeColumnHint(error);
    return NextResponse.json({ error: hint ?? error.message }, { status: hint ? 503 : 500 });
  }
  let updated = existing;

  if (!updated && baseDomain === "vault.cool") {
    const { data: profile } = await admin
      .from("profiles")
      .select("vanity_subdomain")
      .eq("id", auth.identity.userId)
      .maybeSingle();
    if (profile?.vanity_subdomain === validation.name) {
      const { data: inserted } = await admin
        .from("domain_claims")
        .insert({ user_id: auth.identity.userId, subdomain: validation.name, base_domain: baseDomain, theme })
        .select("subdomain, base_domain, theme")
        .maybeSingle();
      updated = inserted ?? null;
    }
  }

  if (!updated) {
    return NextResponse.json(
      { error: `${validation.name}.${baseDomain} isn't one of your claims.` },
      { status: 404 }
    );
  }

  return NextResponse.json({
    domain: `${updated.subdomain}.${updated.base_domain}`,
    theme: updated.theme,
    message: updated.theme
      ? `${updated.subdomain}.${updated.base_domain} now wears ${updated.theme}. ✨`
      : `${updated.subdomain}.${updated.base_domain} is back on the ${baseDomain} default look.`,
  });
}
