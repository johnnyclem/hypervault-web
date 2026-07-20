
const REGISTRY_BASE = "https://registry.modelcontextprotocol.io/v0/servers";
const SEARCH_TIMEOUT_MS = 8_000;

export type RegistryServer = {
  registryId: string;
  name: string;
  description: string;
  url: string;
  transport: "streamable-http" | "sse";
  version?: string;
  dead?: boolean;
};

type RegistryRemote = { type?: string; transport_type?: string; transportType?: string; url?: string };

const REGISTRY_META_KEY = "io.modelcontextprotocol.registry/official";

function isActive(wrapper: Record<string, unknown>): boolean {
  const meta = wrapper._meta;
  if (!meta || typeof meta !== "object") return true;
  const official = (meta as Record<string, unknown>)[REGISTRY_META_KEY];
  if (!official || typeof official !== "object") return true;
  const status = (official as Record<string, unknown>).status;
  return typeof status !== "string" || status === "active";
}

export function parseRegistryPayload(json: unknown): RegistryServer[] {
  if (!json || typeof json !== "object") return [];
  const list = (json as { servers?: unknown[] }).servers;
  if (!Array.isArray(list)) return [];

  const out: RegistryServer[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const wrapper = entry as Record<string, unknown>;
    if (!isActive(wrapper)) continue;
    const server = (wrapper.server && typeof wrapper.server === "object" ? wrapper.server : wrapper) as Record<
      string,
      unknown
    >;
    const name = typeof server.name === "string" ? server.name : "";
    if (!name || seen.has(name)) continue;
    const remotes = Array.isArray(server.remotes) ? (server.remotes as RegistryRemote[]) : [];

    let picked: { url: string; transport: "streamable-http" | "sse" } | null = null;
    for (const remote of remotes) {
      const type = (remote.type ?? remote.transport_type ?? remote.transportType ?? "").toString();
      const url = typeof remote.url === "string" ? remote.url : "";
      if (!url || !/^https?:\/\//.test(url)) continue;
      if (/streamable/.test(type)) {
        picked = { url, transport: "streamable-http" };
        break;
      }
      if (!picked && /sse/.test(type)) picked = { url, transport: "sse" };
    }
    if (!picked) continue;

    seen.add(name);
    out.push({
      registryId: name,
      name: name.split("/").pop() || name,
      description: typeof server.description === "string" ? server.description.slice(0, 300) : "",
      url: picked.url,
      transport: picked.transport,
      version: typeof server.version === "string" ? server.version : undefined,
    });
  }
  return out;
}

export async function searchRegistry(query: string, limit = 20): Promise<RegistryServer[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ limit: "100", version: "latest" });
    if (query.trim()) params.set("search", query.trim());
    const res = await fetch(`${REGISTRY_BASE}?${params}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    return parseRegistryPayload(await res.json()).slice(0, limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function annotateDeadServers(servers: RegistryServer[], deadUrls: Set<string>): RegistryServer[] {
  const norm = (u: string) => u.replace(/\/$/, "");
  const marked = servers.map((s) => (deadUrls.has(norm(s.url)) ? { ...s, dead: true } : s));
  return [...marked].sort((a, b) => Number(Boolean(a.dead)) - Number(Boolean(b.dead)));
}

export function suggestedServers(): RegistryServer[] {
  const url = process.env.HYPERVAULT_MCP_URL;
  if (!url) return [];
  return [
    {
      registryId: "hypervault",
      name: "HyperVault",
      description:
        "This vault's own tools: save artifacts, claim vanity subdomains, connect items, and manage wiki memories.",
      url,
      transport: "streamable-http",
    },
  ];
}
