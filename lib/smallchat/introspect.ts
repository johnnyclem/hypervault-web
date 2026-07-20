
import type { JSONSchemaType, ProviderManifest } from "@/lib/vendor/smallchat/core/types";
import { McpAuthError, McpHttpClient, McpHttpError, isDeadEndpointStatus } from "@/lib/smallchat/jsonrpc";

export type IntrospectedTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type IntrospectResult =
  | { ok: true; serverName?: string; tools: IntrospectedTool[] }
  | { ok: false; error: string; authRequired?: false; status?: number; dead?: boolean }
  | { ok: false; error: string; authRequired: true; status: number; wwwAuthenticate: string | null };

export async function introspectMcpServer(
  url: string,
  headers?: Record<string, string>
): Promise<IntrospectResult> {
  try {
    const client = new McpHttpClient(url, headers ?? {});
    const { serverName } = await client.initialize();
    const raw = await client.listTools();
    const tools = raw
      .filter((t) => typeof t.name === "string" && t.name.length > 0)
      .map((t) => ({
        name: t.name,
        description: typeof t.description === "string" ? t.description : "",
        input_schema:
          t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object" },
      }));
    return { ok: true, serverName, tools };
  } catch (err) {
    if (err instanceof McpAuthError) {
      return {
        ok: false,
        error: err.message,
        authRequired: true,
        status: err.status,
        wwwAuthenticate: err.wwwAuthenticate,
      };
    }
    if (err instanceof McpHttpError) {
      return { ok: false, error: err.message, status: err.status, dead: isDeadEndpointStatus(err.status) };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Introspection failed." };
  }
}

export function toProviderManifest(
  server: { id: string; name: string; url: string },
  tools: IntrospectedTool[],
  disabledTools: string[]
): ProviderManifest {
  const disabled = new Set(disabledTools);
  return {
    id: server.id,
    name: server.name,
    transportType: "mcp",
    endpoint: server.url,
    tools: tools
      .filter((t) => !disabled.has(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description || t.name,
        inputSchema: t.input_schema as unknown as JSONSchemaType,
        providerId: server.id,
        transportType: "mcp" as const,
      })),
  };
}
