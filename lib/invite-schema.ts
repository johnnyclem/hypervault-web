
import type { DbError } from "@/lib/backends/schema-compat";

const INVITE_TABLES = /invite_codes|account_access|waitlist/;

export function isMissingInviteTable(error: DbError): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (!INVITE_TABLES.test(message)) return false;
  return error.code === "PGRST205" || error.code === "42P01" || /schema cache|does not exist/i.test(message);
}

export function isMissingRedeemFunction(error: DbError): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (!message.includes("redeem_invite_code")) return false;
  return error.code === "PGRST202" || error.code === "42883" || /schema cache|does not exist/i.test(message);
}

export const INVITE_MIGRATION_HINT =
  "The database is missing the invite tables — apply supabase/migrations/0011_invite_gate.sql " +
  "(`supabase db push`, or paste it into the Supabase SQL editor), then try again.";
