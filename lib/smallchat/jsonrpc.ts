
type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
};

export type RawMcpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export class McpAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly wwwAuthenticate: string | null
  ) {
    super(message);
    this.name = "McpAuthError";
  }
}

export class McpHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "McpHttpError";
  }
}

export function isDeadEndpointStatus(status: number): boolean {
  return status === 404 || status === 410;
}

const PROTOCOL_VERSION = "2025-06-18";

export function parseJsonRpcBody(text: string, contentType: string | null): JsonRpcResponse {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const isSse = (contentType ?? "").includes("text/event-stream") || trimmed.startsWith("event:") || trimmed.startsWith("data:");
  if (!isSse) {
    try {
      return JSON.parse(trimmed) as JsonRpcResponse;
    } catch {
      throw new Error("The server returned a response that is not valid JSON.");
    }
  }
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload) as JsonRpcResponse;
      if (parsed.result !== undefined || parsed.error !== undefined) return parsed;
    } catch {
    }
  }
  throw new Error("The server's event stream contained no JSON-RPC response.");
}

export class McpHttpClient {
  private sessionId: string | null = null;
  private initialized: Promise<{ serverName?: string }> | null = null;
  private nextId = 1;

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string> = {},
    private readonly timeoutMs = 15_000
  ) {}

  private async post(body: object, expectReply: boolean): Promise<JsonRpcResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...this.headers,
      };
      if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
      const res = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const session = res.headers.get("mcp-session-id");
      if (session) this.sessionId = session;
      if (!expectReply) {
        return {};
      }
      const text = await res.text();
      if (!res.ok) {
        const wwwAuthenticate = res.headers.get("www-authenticate");
        if (res.status === 401 || (res.status === 403 && wwwAuthenticate)) {
          throw new McpAuthError(
            "Authorization required to connect to this MCP server.",
            res.status,
            wwwAuthenticate
          );
        }
        try {
          const parsed = parseJsonRpcBody(text, res.headers.get("content-type"));
          if (parsed.error?.message) throw new Error(parsed.error.message);
        } catch (err) {
          if (err instanceof Error && !/valid JSON|event stream/.test(err.message)) throw err;
        }
        throw new McpHttpError(
          isDeadEndpointStatus(res.status)
            ? `No MCP server found at this URL (HTTP ${res.status}).`
            : `The MCP server responded with HTTP ${res.status}.`,
          res.status
        );
      }
      const parsed = parseJsonRpcBody(text, res.headers.get("content-type"));
      if (parsed.error) {
        throw new Error(parsed.error.message || `MCP error ${parsed.error.code ?? ""}`.trim());
      }
      return parsed;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`No response from ${this.url} within ${Math.round(this.timeoutMs / 1000)}s.`);
      }
      if (err instanceof TypeError) {
        throw new Error(`Could not reach ${this.url} — check the URL and that the server is online.`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  initialize(): Promise<{ serverName?: string }> {
    if (!this.initialized) {
      this.initialized = (async () => {
        const res = await this.post(
          {
            jsonrpc: "2.0",
            id: this.nextId++,
            method: "initialize",
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "hypervault", version: "1.0" },
            },
          },
          true
        );
        const info = (res.result as { serverInfo?: { name?: string } } | undefined)?.serverInfo;
        await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, false);
        return { serverName: info?.name };
      })();
      this.initialized.catch(() => {
        this.initialized = null;
      });
    }
    return this.initialized;
  }

  async listTools(): Promise<RawMcpTool[]> {
    await this.initialize();
    const tools: RawMcpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await this.post(
        {
          jsonrpc: "2.0",
          id: this.nextId++,
          method: "tools/list",
          params: cursor ? { cursor } : {},
        },
        true
      );
      const result = res.result as { tools?: RawMcpTool[]; nextCursor?: string } | undefined;
      tools.push(...(result?.tools ?? []));
      cursor = result?.nextCursor || undefined;
      if (!cursor) break;
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ content: unknown; isError: boolean }> {
    await this.initialize();
    const res = await this.post(
      {
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "tools/call",
        params: { name, arguments: args },
      },
      true
    );
    const result = res.result as { content?: unknown; isError?: boolean } | undefined;
    return { content: result?.content ?? null, isError: Boolean(result?.isError) };
  }
}
