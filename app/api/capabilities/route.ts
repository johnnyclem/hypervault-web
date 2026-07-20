import { NextResponse, type NextRequest } from "next/server";
import { bearerToken, resolveApiIdentity } from "@/lib/api-auth";
import { encryptionAvailable } from "@/lib/backends/crypto";
import { PROVIDERS } from "@/lib/backends/providers";
import { domainPortfolio, MAX_PRO_SUBDOMAINS } from "@/lib/domains";
import { isStenographerConfigured } from "@/lib/stenographer/client";
import { supabaseConfigured } from "@/lib/supabase/server";
import { THEMES } from "@/lib/themes";
import { appUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const body: Record<string, unknown> = {
    app_url: appUrl(),
    api_version: "2026-07-15",
    auth: {
      supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
      supabase_anon_key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
      bearer_header: "Authorization",
      api_key_header: "X-HyperVault-Key",
      invite_gated: true,
    },
    features: {
      configured: supabaseConfigured(),
      deep_memory: isStenographerConfigured(),
      key_encryption: encryptionAvailable(),
      smart_context: true,
      on_device_inference: true,
      dreaming: true,
    },
    limits: {
      artifact_bytes: 1_000_000,
      source_prompt_chars: 10_000,
      chat_message_chars: 100_000,
      memory_bytes: 500_000,
      import_bytes: 50_000_000,
      max_backends: 20,
      max_mcp_servers: 20,
      max_pro_subdomains: MAX_PRO_SUBDOMAINS,
      rate_limit_per_min: { api_key: 60, user: 120 },
    },
    providers: Object.values(PROVIDERS),
    domains: domainPortfolio(),
    themes: THEMES.map((t) => ({ id: t.styleId, name: t.styleName, mode: t.mode })),
  };

  const hasCredential = req.headers.get("X-HyperVault-Key") || bearerToken(req);
  if (hasCredential) {
    const auth = await resolveApiIdentity(req);
    if (!("error" in auth)) {
      body.user = {
        id: auth.identity.userId,
        email: auth.identity.email ?? null,
        via: auth.identity.via,
      };
    }
  }

  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
