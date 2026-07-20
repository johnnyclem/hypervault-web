export function missingThemeColumnHint(error: { code?: string; message: string }): string | null {
  const missingColumn =
    error.code === "PGRST204" || error.code === "42703" || /schema cache/i.test(error.message);
  if (!missingColumn || !/theme/i.test(error.message)) return null;
  return (
    "Theme storage isn't provisioned in the database yet — run " +
    "supabase/migrations/0015_dashboard_theme.sql (Supabase SQL editor or `supabase db push`), then try again."
  );
}

export function missingChatSettingsColumnHint(error: {
  code?: string;
  message: string;
}): string | null {
  const missingColumn =
    error.code === "PGRST204" || error.code === "42703" || /schema cache/i.test(error.message);
  if (!missingColumn || !/chat_smart_context|chat_deep_memory|chat_polytician/i.test(error.message)) return null;
  const migration = /chat_polytician/i.test(error.message)
    ? "supabase/migrations/0020_polytician_settings.sql"
    : "supabase/migrations/0017_chat_context_settings.sql";
  return (
    "Chat context settings aren't provisioned in the database yet — run " +
    `${migration} (Supabase SQL editor or \`supabase db push\`), then try again.`
  );
}

export function missingDreamingSchemaHint(error: { code?: string; message: string } | null): string | null {
  if (!error) return null;
  const missing =
    error.code === "PGRST204" ||
    error.code === "42703" ||
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    /schema cache/i.test(error.message);
  if (!missing || !/dreaming_enabled|dream_runs|dream_connections/i.test(error.message)) return null;
  return (
    "Dreaming isn't provisioned in the database yet — run " +
    "supabase/migrations/0024_dreaming.sql (Supabase SQL editor or `supabase db push`), then try again."
  );
}

export function missingDigestionSchemaHint(error: { code?: string; message: string } | null): string | null {
  if (!error) return null;
  const missing =
    error.code === "PGRST204" ||
    error.code === "42703" ||
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    /schema cache/i.test(error.message);
  if (!missing || !/digestion_enabled|digest_runs|digest_segments/i.test(error.message)) return null;
  return (
    "Digesting isn't provisioned in the database yet — run " +
    "supabase/migrations/0025_digestion.sql (Supabase SQL editor or `supabase db push`), then try again."
  );
}

export function missingVaultColumnHint(
  error: { code?: string; message: string } | null
): string | null {
  if (!error) return null;
  const missingColumn =
    error.code === "42703" || error.code === "PGRST204" || /schema cache/i.test(error.message);
  if (!missingColumn || !/auth_headers_secret_id|oauth_grant_secret_id/i.test(error.message)) return null;
  return (
    "AgentVault secret references aren't provisioned in the database yet — run " +
    "supabase/migrations/0023_agent_vault.sql (Supabase SQL editor or `supabase db push`), then try again."
  );
}

export function missingJobsTableHint(error: { code?: string; message: string } | null): string | null {
  if (!error) return null;
  const missingTable =
    error.code === "PGRST205" || error.code === "42P01" || /schema cache/i.test(error.message);
  if (!missingTable || !/public\.jobs|'jobs'/i.test(error.message)) return null;
  return (
    "Background jobs aren't provisioned in the database yet — run " +
    "supabase/migrations/0027_async_jobs.sql (Supabase SQL editor or `supabase db push`), then try again."
  );
}

export function missingToolkitsTableHint(error: {
  code?: string;
  message: string;
} | null): string | null {
  if (!error) return null;
  const missingTable =
    error.code === "PGRST205" || error.code === "42P01" || /schema cache/i.test(error.message);
  if (!missingTable || !/mcp_servers|toolkits/i.test(error.message)) return null;
  return (
    "The tools feature isn't provisioned in the database yet — run " +
    "supabase/migrations/0018_smallchat_toolkits.sql (Supabase SQL editor or `supabase db push`), then try again."
  );
}
