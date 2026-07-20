
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  describeEmbedder,
  isLexicalEmbedder,
  onnxDiagnostics,
  resolveEmbedder,
  type EmbedderIdentity,
} from "@/lib/smallchat/embedder";
import { resolveServerAuth } from "@/lib/smallchat/mcp-auth";
import {
  introspectMcpServer,
  toProviderManifest,
  type IntrospectedTool,
} from "@/lib/smallchat/introspect";
import { withVaultColumns } from "@/lib/smallchat/server-rows";
import { missingToolkitsTableHint } from "@/lib/supabase/errors";
import { ToolCompiler } from "@/lib/vendor/smallchat/compiler/compiler";
import type { ProviderManifest } from "@/lib/vendor/smallchat/core/types";
import { MemoryVectorIndex } from "@/lib/vendor/smallchat/embedding/memory-vector-index";
import { buildArtifact } from "@/lib/vendor/smallchat/mcp/artifact";

export type McpServerRow = {
  id: string;
  name: string;
  url: string;
  auth_headers_cipher: string | null;
  oauth_grant_cipher: string | null;
  auth_headers_secret_id: string | null;
  oauth_grant_secret_id: string | null;
  enabled: boolean;
  disabled_tools: string[];
  tools_cache: IntrospectedTool[];
};

export type CompileOutcome = {
  toolkitId: string;
  stats: {
    toolCount: number;
    uniqueSelectorCount: number;
    providerCount: number;
    collisionCount: number;
  };
  collisions: Array<{ selectorA: string; selectorB: string; similarity: number; hint: string }>;
  embedder: EmbedderIdentity;
  embedderLabel: string;
  embedderDegradeReason: string | null;
  skippedServers: Array<{ id: string; name: string; error: string }>;
};

export class CompileError extends Error {
  constructor(
    readonly code: "no_enabled_tools" | "all_servers_unreachable",
    message: string
  ) {
    super(message);
  }
}

const KEEP_TOOLKITS = 3;

export { decryptHeaders } from "@/lib/smallchat/mcp-auth";

const AREA_NOISE_WORDS = new Set([
  "list", "get", "fetch", "read", "show", "view", "find", "query",
  "create", "add", "new", "make", "update", "edit", "set", "patch", "apply",
  "manage", "modify", "change", "replace", "rename", "move", "reorder",
  "delete", "remove", "clear", "restore", "duplicate", "copy",
  "append", "insert", "save", "write", "upload", "download", "issue",
  "search", "deploy", "bulk", "signed", "url", "html",
  "style", "merge", "unmerge", "format", "sort", "filter", "split", "resize", "group",
  "a", "an", "the", "to", "from", "into", "by", "of", "my", "before", "after", "full",
]);

function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function toolArea(name: string): string | null {
  const words = nameWords(name);
  return words.find((w) => !AREA_NOISE_WORDS.has(w)) ?? null;
}

function areaKey(area: string): string {
  return area.length > 3 && area.endsWith("s") ? area.slice(0, -1) : area;
}

const MAX_AREAS_PER_SERVER = 24;

export function buildCapabilityHeader(manifests: ProviderManifest[]): string {
  const lines: string[] = [];
  for (const manifest of manifests) {
    if (manifest.tools.length === 0) continue;
    const seen = new Set<string>();
    const areas: string[] = [];
    for (const tool of manifest.tools) {
      const area = toolArea(tool.name);
      if (!area) continue;
      const key = areaKey(area);
      if (seen.has(key)) continue;
      seen.add(key);
      areas.push(area);
    }
    const shown = areas.slice(0, MAX_AREAS_PER_SERVER);
    const more = areas.length - shown.length;
    const suffix = more > 0 ? `, +${more} more` : "";
    lines.push(`- ${manifest.name}: ${shown.join(", ")}${suffix}`);
  }
  return lines.join("\n").trim();
}

export async function compileToolkit(admin: SupabaseClient, userId: string): Promise<CompileOutcome> {
  const { data: servers, error: serversError } = await admin
    .from("mcp_servers")
    .select(
      await withVaultColumns(
        "id, name, url, auth_headers_cipher, oauth_grant_cipher, enabled, disabled_tools, tools_cache",
        admin
      )
    )
    .eq("user_id", userId)
    .eq("enabled", true)
    .order("created_at", { ascending: true })
    .returns<McpServerRow[]>();

  const hint = missingToolkitsTableHint(serversError);
  if (hint) throw new CompileError("no_enabled_tools", hint);

  const rows = servers ?? [];
  if (rows.length === 0) {
    throw new CompileError("no_enabled_tools", "No enabled MCP servers — add or enable one first.");
  }

  const skippedServers: CompileOutcome["skippedServers"] = [];
  const introspected = await Promise.all(
    rows.map(async (row) => {
      const result = await introspectMcpServer(
        row.url,
        await resolveServerAuth({ ...row, user_id: userId }, admin)
      );
      if (result.ok) {
        await admin
          .from("mcp_servers")
          .update({ tools_cache: result.tools, introspected_at: new Date().toISOString() })
          .eq("id", row.id);
        return { row, tools: result.tools };
      }
      const cached = Array.isArray(row.tools_cache) ? row.tools_cache : [];
      if (cached.length > 0) {
        skippedServers.push({ id: row.id, name: row.name, error: `${result.error} (using cached tool list)` });
        return { row, tools: cached };
      }
      skippedServers.push({ id: row.id, name: row.name, error: result.error });
      return { row, tools: [] as IntrospectedTool[] };
    })
  );

  const manifests = introspected
    .map(({ row, tools }) =>
      toProviderManifest({ id: row.id, name: row.name, url: row.url }, tools, row.disabled_tools ?? [])
    )
    .filter((m) => m.tools.length > 0);

  if (manifests.length === 0) {
    const anyReachable = introspected.some(({ tools }) => tools.length > 0);
    if (!anyReachable && skippedServers.length > 0) {
      throw new CompileError(
        "all_servers_unreachable",
        `No MCP server could be reached: ${skippedServers.map((s) => `${s.name} (${s.error})`).join("; ")}`
      );
    }
    throw new CompileError("no_enabled_tools", "Every tool is toggled off — enable at least one.");
  }

  const { embedder, identity } = await resolveEmbedder(admin, userId);
  const compiler = new ToolCompiler(embedder, new MemoryVectorIndex(), { compileApps: false });
  const result = await compiler.compile(manifests);
  const artifact = buildArtifact(result, manifests);
  const header = buildCapabilityHeader(manifests);

  const endpoints = Object.fromEntries(
    introspected.map(({ row }) => [
      row.id,
      {
        url: row.url,
        name: row.name,
        server_id: row.id,
        headers_cipher: row.auth_headers_cipher,
        oauth_grant_cipher: row.oauth_grant_cipher,
      },
    ])
  );

  await admin.from("toolkits").update({ is_active: false }).eq("user_id", userId).eq("is_active", true);
  const { data: created, error: insertError } = await admin
    .from("toolkits")
    .insert({
      user_id: userId,
      artifact,
      header,
      embedder: identity,
      endpoints,
      stats: artifact.stats,
      is_active: true,
    })
    .select("id")
    .single();
  if (insertError || !created) {
    throw new Error(`Compiled, but the toolkit could not be saved: ${insertError?.message ?? "unknown error"}`);
  }

  const { data: old } = await admin
    .from("toolkits")
    .select("id")
    .eq("user_id", userId)
    .order("compiled_at", { ascending: false })
    .range(KEEP_TOOLKITS, KEEP_TOOLKITS + 20);
  if (old && old.length > 0) {
    await admin
      .from("toolkits")
      .delete()
      .in(
        "id",
        old.map((r) => r.id)
      );
  }

  return {
    toolkitId: created.id,
    stats: artifact.stats,
    collisions: result.collisions.map((c) => ({
      selectorA: c.selectorA,
      selectorB: c.selectorB,
      similarity: c.similarity,
      hint: c.hint,
    })),
    embedder: identity,
    embedderLabel: describeEmbedder(identity),
    embedderDegradeReason: isLexicalEmbedder(identity) ? onnxDiagnostics().error : null,
    skippedServers,
  };
}
