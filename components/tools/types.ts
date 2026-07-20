
export type ServerTool = {
  name: string;
  description: string;
  input_schema?: Record<string, unknown>;
};

export type AuthType = "oauth" | "headers" | "none";

export type ServerRow = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  disabled_tools: string[];
  tools_cache: ServerTool[];
  introspected_at: string | null;
  registry_id: string | null;
  has_auth: boolean;
  secret_backed?: boolean;
  auth_type: AuthType;
};

export type ServerDraft = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  disabledTools: string[];
  tools: ServerTool[];
  introspectedAt: string | null;
  hasAuth: boolean;
  secretBacked: boolean;
  authType: AuthType;
};

export type ToolkitSummary = {
  id: string;
  stats: {
    toolCount: number;
    uniqueSelectorCount: number;
    providerCount: number;
    collisionCount: number;
  };
  embedder_label: string;
  compiled_at: string;
};

export type RegistryEntry = {
  registryId: string;
  name: string;
  description: string;
  url: string;
  transport: "streamable-http" | "sse";
  dead?: boolean;
};

export type AddCandidate = {
  url: string;
  name?: string;
  registryId?: string;
  headers?: Record<string, string>;
  transport?: string;
};

export function toDraft(row: ServerRow): ServerDraft {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    enabled: row.enabled,
    disabledTools: [...(row.disabled_tools ?? [])].sort(),
    tools: row.tools_cache ?? [],
    introspectedAt: row.introspected_at,
    hasAuth: row.has_auth,
    secretBacked: row.secret_backed ?? false,
    authType: row.auth_type ?? (row.has_auth ? "headers" : "none"),
  };
}

export function cloneDrafts(drafts: ServerDraft[]): ServerDraft[] {
  return drafts.map((d) => ({ ...d, disabledTools: [...d.disabledTools], tools: d.tools }));
}

export function draftsDiffer(a: ServerDraft[], b: ServerDraft[]): boolean {
  const key = (list: ServerDraft[]) =>
    JSON.stringify(
      list.map((d) => ({ id: d.id, enabled: d.enabled, disabled: [...d.disabledTools].sort() }))
    );
  return key(a) !== key(b);
}

export function countPendingChanges(draft: ServerDraft[], persisted: ServerDraft[]): number {
  const byId = new Map(persisted.map((p) => [p.id, p]));
  let changes = 0;
  for (const d of draft) {
    const p = byId.get(d.id);
    if (!p) {
      changes += 1;
      continue;
    }
    if (p.enabled !== d.enabled) changes += 1;
    const pd = new Set(p.disabledTools);
    const dd = new Set(d.disabledTools);
    for (const t of dd) if (!pd.has(t)) changes += 1;
    for (const t of pd) if (!dd.has(t)) changes += 1;
  }
  return changes;
}
