import crypto from "node:crypto";


export function starRepo(): string {
  return (process.env.GITHUB_STAR_REPO ?? "johnnyclem/hypervault").trim();
}

function githubHeaders(accept = "application/vnd.github+json"): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "hypervault-star-invites",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export type Stargazer = {
  githubId: number;
  login: string;
  avatarUrl: string | null;
  starredAt: string | null;
};

export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string
): boolean {
  if (!signature || !secret) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = Buffer.from(signature);
  const computed = Buffer.from(expected);
  if (received.length !== computed.length) return false;
  return crypto.timingSafeEqual(received, computed);
}

export async function fetchStargazers(repo = starRepo(), maxPages = 50): Promise<Stargazer[]> {
  const out: Stargazer[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/stargazers?per_page=100&page=${page}`,
      { headers: githubHeaders("application/vnd.github.star+json") }
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`GitHub stargazers ${res.status}: ${detail.slice(0, 200)}`);
    }
    const rows = (await res.json()) as Array<{
      starred_at?: string;
      user?: { id: number; login: string; avatar_url?: string };
    }>;
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      const user = row.user;
      if (!user?.id || !user.login) continue;
      out.push({
        githubId: user.id,
        login: user.login,
        avatarUrl: user.avatar_url ?? null,
        starredAt: row.starred_at ?? null,
      });
    }
    if (rows.length < 100) break;
  }
  return out;
}

export async function fetchUserEmail(login: string): Promise<string | null> {
  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
    headers: githubHeaders(),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const user = (await res.json().catch(() => null)) as { email?: string | null } | null;
  return user?.email ?? null;
}
