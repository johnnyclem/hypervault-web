
import { McpAuthError, McpHttpClient, McpHttpError, isDeadEndpointStatus } from "@/lib/smallchat/jsonrpc";

export type LivenessState = "alive" | "dead" | "unknown";

export type LivenessResult = { url: string; state: LivenessState; status?: number };

const PROBE_TIMEOUT_MS = 6_000;

export async function probeLiveness(url: string, headers?: Record<string, string>): Promise<LivenessResult> {
  try {
    const client = new McpHttpClient(url, headers ?? {}, PROBE_TIMEOUT_MS);
    await client.initialize();
    return { url, state: "alive" };
  } catch (err) {
    if (err instanceof McpAuthError) return { url, state: "alive", status: err.status };
    if (err instanceof McpHttpError) {
      return { url, state: isDeadEndpointStatus(err.status) ? "dead" : "unknown", status: err.status };
    }
    return { url, state: "unknown" };
  }
}
