
export type DbError = { code?: string | null; message?: string | null } | null;

export function isMissingEmbeddingColumn(error: DbError): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (!message.includes("embedding_model")) return false;
  return error.code === "PGRST204" || error.code === "42703" || /column|schema cache/i.test(message);
}

export function isStaleProviderConstraint(error: DbError): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return error.code === "23514" || message.includes("llm_backends_provider_check");
}

export function isMissingToolkitColumn(error: DbError): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (!message.includes("toolkit_id")) return false;
  return error.code === "PGRST204" || error.code === "42703" || /column|schema cache/i.test(message);
}

export const EMBEDDING_MIGRATION_HINT =
  "The database is missing the embedding_model column — apply supabase/migrations/0012_embedding_backends.sql " +
  "(`supabase db push`, or paste it into the Supabase SQL editor), then reconnect. " +
  "Or leave the embedding model blank to connect without semantic recall.";

export const PROVIDER_MIGRATION_HINT =
  "The database doesn't allow Anthropic-compatible custom backends yet — apply " +
  "supabase/migrations/0013_custom_anthropic_backend.sql (`supabase db push`, or paste it into the " +
  "Supabase SQL editor), then reconnect.";
