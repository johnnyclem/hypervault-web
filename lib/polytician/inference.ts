
export type InferenceBackendRow = {
  id: string;
  provider: string;
  base_url: string | null;
  default_model: string | null;
  api_key_cipher: string | null;
  last_used_at: string | null;
  created_at: string;
};

export function pickBackend(rows: InferenceBackendRow[], preferred?: string): InferenceBackendRow | null {
  if (rows.length === 0) return null;
  const byRecency = [...rows].sort((a, b) => {
    const at = a.last_used_at ? Date.parse(a.last_used_at) : -Infinity;
    const bt = b.last_used_at ? Date.parse(b.last_used_at) : -Infinity;
    if (bt !== at) return bt - at;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
  if (preferred === "local") {
    const local = byRecency.find((r) => r.provider === "ollama" || r.provider === "lmstudio");
    if (local) return local;
  }
  return byRecency[0];
}
