import type { SupabaseClient } from "@supabase/supabase-js";

export type ConnectionKind = "manual" | "auto";

type ArtifactLite = {
  id: string;
  slug: string;
  title: string;
  tags: string[] | null;
};

const AUTO_CONNECT_CAP = 5;
const KEYWORD_OVERLAP_MIN = 2;

const STOPWORDS = new Set([
  "a", "an", "and", "app", "for", "from", "how", "in", "into", "my", "new",
  "of", "on", "or", "page", "the", "this", "to", "untitled", "with", "your",
]);

export function titleKeywords(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return new Set(words);
}

function pairKey(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

export async function createConnections(
  db: SupabaseClient,
  userId: string,
  artifactId: string,
  targetIds: string[],
  kind: ConnectionKind
): Promise<number> {
  const rows = [...new Set(targetIds)]
    .filter((t) => t && t !== artifactId)
    .map((t) => {
      const [a, b] = pairKey(artifactId, t);
      return { user_id: userId, a_id: a, b_id: b, kind };
    });
  if (rows.length === 0) return 0;

  const { error } = await db
    .from("connections")
    .upsert(rows, { onConflict: "a_id,b_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return rows.length;
}

export function resolveConnectTargets(refs: string[], candidates: ArtifactLite[]): string[] {
  const bySlug = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const c of candidates) {
    bySlug.set(c.slug.toLowerCase(), c.id);
    byTitle.set(c.title.trim().toLowerCase(), c.id);
  }
  const ids = new Set<string>();
  for (const ref of refs) {
    const needle = ref.trim().toLowerCase();
    if (!needle) continue;
    const id = bySlug.get(needle) ?? byTitle.get(needle);
    if (id) ids.add(id);
  }
  return [...ids];
}

export function suggestAutoTargets(
  artifact: { id: string; title: string; tags: string[] | null },
  candidates: ArtifactLite[]
): string[] {
  const myTags = new Set((artifact.tags ?? []).map((t) => t.toLowerCase()));
  const myWords = titleKeywords(artifact.title);

  const scored: { id: string; score: number }[] = [];
  for (const c of candidates) {
    if (c.id === artifact.id) continue;
    let sharedTags = 0;
    for (const t of c.tags ?? []) if (myTags.has(t.toLowerCase())) sharedTags++;
    let sharedWords = 0;
    for (const w of titleKeywords(c.title)) if (myWords.has(w)) sharedWords++;

    if (sharedTags >= 1 || sharedWords >= KEYWORD_OVERLAP_MIN) {
      scored.push({ id: c.id, score: sharedTags * 2 + sharedWords });
    }
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, AUTO_CONNECT_CAP).map((s) => s.id);
}

export async function syncConnectionsForArtifact(
  db: SupabaseClient,
  userId: string,
  artifact: { id: string; title: string; tags: string[] | null },
  connectTo: string[]
): Promise<{ manual: number; auto: number }> {
  const { data, error } = await db
    .from("artifacts")
    .select("id, slug, title, tags")
    .eq("user_id", userId)
    .neq("id", artifact.id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  const candidates = (data ?? []) as ArtifactLite[];
  const manualIds = resolveConnectTargets(connectTo, candidates);
  const manual = await createConnections(db, userId, artifact.id, manualIds, "manual");

  const manualSet = new Set(manualIds);
  const autoIds = suggestAutoTargets(artifact, candidates).filter((id) => !manualSet.has(id));
  const auto = await createConnections(db, userId, artifact.id, autoIds, "auto");

  return { manual, auto };
}
