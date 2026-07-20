
import { createAdminClient } from "@/lib/supabase/admin";

export function normalizeEndpoint(url: string): string {
  return url.trim().replace(/\/$/, "");
}

export async function getDeadEndpoints(urls: string[]): Promise<Set<string>> {
  const normalized = Array.from(new Set(urls.map(normalizeEndpoint).filter(Boolean)));
  if (normalized.length === 0) return new Set();
  const admin = createAdminClient();
  if (!admin) return new Set();
  try {
    const { data, error } = await admin
      .from("mcp_dead_endpoints")
      .select("url")
      .in("url", normalized);
    if (error || !data) return new Set();
    return new Set(data.map((row) => row.url as string));
  } catch {
    return new Set();
  }
}

export async function markDeadEndpoint(url: string, httpStatus: number, reason?: string): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;
  try {
    await admin.from("mcp_dead_endpoints").upsert(
      {
        url: normalizeEndpoint(url),
        http_status: httpStatus,
        reason: reason?.slice(0, 300) ?? null,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "url" }
    );
  } catch {
  }
}

export async function clearDeadEndpoint(url: string): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;
  try {
    await admin.from("mcp_dead_endpoints").delete().eq("url", normalizeEndpoint(url));
  } catch {
  }
}
