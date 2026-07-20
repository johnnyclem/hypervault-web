
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  describeEmbedder,
  embedderMatches,
  isEmbedderUpgrade,
  resolveEmbedder,
  type EmbedderIdentity,
} from "@/lib/smallchat/embedder";
import { McpHttpClient } from "@/lib/smallchat/jsonrpc";
import { resolveServerAuth } from "@/lib/smallchat/mcp-auth";
import { withVaultColumns } from "@/lib/smallchat/server-rows";
import { ToolClass } from "@/lib/vendor/smallchat/core/tool-class";
import type {
  ToolIMP,
  ToolResult,
  ToolSchema,
  TransportType,
} from "@/lib/vendor/smallchat/core/types";
import { MemoryVectorIndex } from "@/lib/vendor/smallchat/embedding/memory-vector-index";
import type { SerializedArtifact } from "@/lib/vendor/smallchat/mcp/artifact";
import { ToolRuntime } from "@/lib/vendor/smallchat/runtime/runtime";

export type EndpointSnapshot = {
  url: string;
  name: string;
  server_id?: string;
  headers_cipher: string | null;
  oauth_grant_cipher?: string | null;
};

export type StoredToolkit = {
  id: string;
  artifact: SerializedArtifact;
  header: string;
  embedder: EmbedderIdentity;
  endpoints: Record<string, EndpointSnapshot>;
};

export type HydrateResult =
  | { ok: true; runtime: ToolRuntime; embedder: EmbedderIdentity }
  | {
      ok: false;
      reason: "embedder_mismatch";
      detail: string;
      stored: EmbedderIdentity;
      available: EmbedderIdentity;
      upgrade: boolean;
    }
  | { ok: false; reason: "hydrate_failed"; detail: string };

class HttpToolImp implements ToolIMP {
  schema: ToolSchema | null = null;
  readonly constraints = {
    required: [],
    optional: [],
    validate: () => ({ valid: true, errors: [] }),
  };

  constructor(
    private readonly client: McpHttpClient,
    readonly providerId: string,
    readonly toolName: string,
    readonly transportType: TransportType,
    private readonly canonical: string,
    private readonly inputSchema: Record<string, unknown>
  ) {}

  schemaLoader = async (): Promise<ToolSchema> => ({
    name: this.toolName,
    description: this.canonical,
    inputSchema: { type: "object", ...this.inputSchema } as ToolSchema["inputSchema"],
    arguments: [],
  });

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const { content, isError } = await this.client.callTool(this.toolName, args);
      return { content, isError };
    } catch (err) {
      return {
        content: err instanceof Error ? err.message : "The tool call failed.",
        isError: true,
      };
    }
  }
}

async function resolveEndpointAuth(
  admin: SupabaseClient,
  endpoint: EndpointSnapshot
): Promise<Record<string, string>> {
  if (endpoint.server_id) {
    const { data } = await admin
      .from("mcp_servers")
      .select(await withVaultColumns("id, user_id, auth_headers_cipher, oauth_grant_cipher", admin))
      .eq("id", endpoint.server_id)
      .maybeSingle()
      .returns<{
        id: string;
        user_id: string;
        auth_headers_cipher: string | null;
        oauth_grant_cipher: string | null;
        auth_headers_secret_id?: string | null;
        oauth_grant_secret_id?: string | null;
      }>();
    if (data) {
      return resolveServerAuth(
        {
          id: data.id as string,
          user_id: data.user_id as string,
          auth_headers_cipher: data.auth_headers_cipher as string | null,
          oauth_grant_cipher: data.oauth_grant_cipher as string | null,
          auth_headers_secret_id: data.auth_headers_secret_id as string | null,
          oauth_grant_secret_id: data.oauth_grant_secret_id as string | null,
        },
        admin
      );
    }
  }
  return resolveServerAuth({
    auth_headers_cipher: endpoint.headers_cipher,
    oauth_grant_cipher: endpoint.oauth_grant_cipher ?? null,
  });
}

export async function loadActiveToolkit(admin: SupabaseClient, userId: string): Promise<StoredToolkit | null> {
  const { data } = await admin
    .from("toolkits")
    .select("id, artifact, header, embedder, endpoints")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  return (data as StoredToolkit | null) ?? null;
}

export async function loadToolkit(
  admin: SupabaseClient,
  userId: string,
  toolkitId: string
): Promise<StoredToolkit | null> {
  const { data } = await admin
    .from("toolkits")
    .select("id, artifact, header, embedder, endpoints")
    .eq("user_id", userId)
    .eq("id", toolkitId)
    .maybeSingle();
  return (data as StoredToolkit | null) ?? null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 8;
const runtimeCache = new Map<string, { promise: Promise<HydrateResult>; at: number }>();

export async function hydrateToolkit(
  admin: SupabaseClient,
  userId: string,
  toolkit: StoredToolkit
): Promise<HydrateResult> {
  const cached = runtimeCache.get(toolkit.id);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.promise;

  const promise = hydrate(admin, userId, toolkit);
  runtimeCache.set(toolkit.id, { promise, at: Date.now() });
  if (runtimeCache.size > CACHE_MAX) {
    const oldest = [...runtimeCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) runtimeCache.delete(oldest[0]);
  }
  promise.then((result) => {
    if (!result.ok) runtimeCache.delete(toolkit.id);
  });
  return promise;
}

async function hydrate(
  admin: SupabaseClient,
  userId: string,
  toolkit: StoredToolkit
): Promise<HydrateResult> {
  try {
    const { embedder, identity } = await resolveEmbedder(admin, userId);
    if (!embedderMatches(identity, toolkit.embedder)) {
      const upgrade = isEmbedderUpgrade(toolkit.embedder, identity);
      const detail = upgrade
        ? `The toolkit was compiled with ${describeEmbedder(toolkit.embedder)}, but ${describeEmbedder(identity)} is available now — recompile your tools to use it.`
        : `The toolkit was compiled with ${describeEmbedder(toolkit.embedder)}, which no longer matches the ${describeEmbedder(identity)} available now — recompile your tools.`;
      return {
        ok: false,
        reason: "embedder_mismatch",
        detail,
        stored: toolkit.embedder,
        available: identity,
        upgrade,
      };
    }

    const runtime = new ToolRuntime(new MemoryVectorIndex(), embedder);
    for (const [providerId, methods] of Object.entries(toolkit.artifact.dispatchTables)) {
      const endpoint = toolkit.endpoints[providerId];
      if (!endpoint) continue;
      const headers = await resolveEndpointAuth(admin, endpoint);
      const client = new McpHttpClient(endpoint.url, headers, 30_000);
      const toolClass = new ToolClass(providerId);
      for (const [canonical, imp] of Object.entries(methods)) {
        const sel = toolkit.artifact.selectors[canonical];
        if (!sel) continue;
        const selector = await runtime.selectorTable.intern(new Float32Array(sel.vector), canonical);
        toolClass.addMethod(
          selector,
          new HttpToolImp(
            client,
            imp.providerId,
            imp.toolName,
            imp.transportType as TransportType,
            canonical,
            imp.inputSchema ?? { type: "object" }
          )
        );
      }
      runtime.registerClass(toolClass);
    }
    return { ok: true, runtime, embedder: toolkit.embedder };
  } catch (err) {
    return {
      ok: false,
      reason: "hydrate_failed",
      detail: err instanceof Error ? err.message : "The toolkit could not be loaded.",
    };
  }
}
