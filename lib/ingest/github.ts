import { gunzipSync } from "node:zlib";
import { IngestError, MEMORY_CONTENT_BUDGET_BYTES } from "./limits";


export type GitHubRepoRef = { owner: string; repo: string; ref?: string };

const FETCH_TIMEOUT_MS = 45_000;
const MAX_TARBALL_BYTES = 30_000_000;
const MAX_UNPACKED_BYTES = 120_000_000;
const DIGEST_BUDGET_CHARS = Math.floor(MEMORY_CONTENT_BUDGET_BYTES * 0.9);
const PER_FILE_CHAR_CAP = 30_000;
const TREE_LINE_CAP = 500;
const TEXT_SNIFF_BYTES = 8_000;

export function parseGitHubRepoUrl(raw: string): GitHubRepoRef | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "github.com") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, "");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) return null;

  let ref: string | undefined;
  if (["tree", "blob", "commits", "releases"].includes(parts[2] ?? "") && parts[3] && parts[2] !== "releases") {
    ref = decodeURIComponent(parts[3]);
  }
  return { owner, repo, ref };
}


export type TarEntry = { path: string; data: Uint8Array };

function tarString(block: Uint8Array, start: number, length: number): string {
  const slice = block.subarray(start, start + length);
  const nul = slice.indexOf(0);
  return new TextDecoder().decode(nul === -1 ? slice : slice.subarray(0, nul));
}

function parsePaxPath(data: string): string | null {
  let rest = data;
  while (rest.length > 0) {
    const space = rest.indexOf(" ");
    if (space === -1) break;
    const len = parseInt(rest.slice(0, space), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = rest.slice(space + 1, len - 1);
    rest = rest.slice(len);
    const eq = record.indexOf("=");
    if (eq !== -1 && record.slice(0, eq) === "path") return record.slice(eq + 1);
  }
  return null;
}

export function parseTarEntries(tar: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let nameOverride: string | null = null;

  while (offset + 512 <= tar.length) {
    const block = tar.subarray(offset, offset + 512);
    if (block.every((b) => b === 0)) break;

    const size = parseInt(tarString(block, 124, 12).trim() || "0", 8) || 0;
    const typeByte = block[156];
    const data = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    const type = String.fromCharCode(typeByte);
    if (type === "L") {
      nameOverride = new TextDecoder().decode(data).replace(/\0+$/, "");
      continue;
    }
    if (type === "x") {
      const p = parsePaxPath(new TextDecoder().decode(data));
      if (p) nameOverride = p;
      continue;
    }
    if (type === "g") continue;
    if (typeByte !== 0 && type !== "0") continue;

    const name = tarString(block, 0, 100);
    const prefix = tarString(block, 345, 155);
    const path = nameOverride ?? (prefix ? `${prefix}/${name}` : name);
    nameOverride = null;
    if (path) entries.push({ path, data });
  }
  return entries;
}


const SKIP_DIR_RE =
  /(^|\/)(node_modules|\.git|\.github\/workflows\/.+\.lock|dist|build|out|vendor|\.next|target|coverage|__pycache__|\.venv|venv|\.idea|\.vscode)(\/|$)/;
const SKIP_FILE_RE =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|composer\.lock|gemfile\.lock|poetry\.lock|uv\.lock|go\.sum|\.ds_store)$|\.(min\.js|min\.css|map|snap)$/i;
const BINARY_EXT_RE =
  /\.(png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|psd|pdf|zip|gz|tgz|bz2|xz|7z|rar|tar|woff2?|ttf|eot|otf|mp[34]|mov|avi|mkv|webm|ogg|wav|flac|wasm|exe|dll|so|dylib|a|o|jar|class|pyc|pyo|db|sqlite3?|bin|dat|pack|idx|node)$/i;

function isProbablyText(data: Uint8Array): boolean {
  const sniff = data.subarray(0, TEXT_SNIFF_BYTES);
  return sniff.indexOf(0) === -1;
}

export function filePriority(path: string): number {
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  const depth = path.split("/").length;

  if (/^readme(\.|$)/.test(base)) return 0;
  if (
    depth === 1 &&
    /^(package\.json|cargo\.toml|pyproject\.toml|go\.mod|gemfile|composer\.json|makefile|dockerfile|setup\.py|build\.gradle|pom\.xml|.*\.gemspec)$/.test(base)
  ) {
    return 1;
  }
  if (/^(docs|doc)\//.test(lower) || /\.(md|mdx|rst)$/.test(base)) return 2;
  if (/(^|\/)(tests?|__tests__|spec|specs|__mocks__|fixtures|examples?)(\/|\.)/.test(lower)) return 8;
  return 3 + Math.min(depth, 20) * 0.1;
}

function renderTree(paths: string[]): string {
  const lines: string[] = [];
  const seenDirs = new Set<string>();
  for (const path of [...paths].sort()) {
    const parts = path.split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts.slice(0, i + 1).join("/");
      if (!seenDirs.has(dir)) {
        seenDirs.add(dir);
        lines.push(`${"  ".repeat(i)}${parts[i]}/`);
      }
    }
    lines.push(`${"  ".repeat(parts.length - 1)}${parts[parts.length - 1]}`);
  }
  if (lines.length > TREE_LINE_CAP) {
    return [...lines.slice(0, TREE_LINE_CAP), `… and ${lines.length - TREE_LINE_CAP} more entries`].join("\n");
  }
  return lines.join("\n");
}

export type RepoDigest = { title: string; content: string; tags: string[]; fileCount: number };

export function buildRepoDigest(repo: GitHubRepoRef, entries: TarEntry[], generatedAt: Date = new Date()): RepoDigest {
  const files = entries
    .map((e) => ({ ...e, path: e.path.split("/").slice(1).join("/") }))
    .filter((e) => e.path.length > 0);

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const textFiles = files
    .filter(
      (f) =>
        !SKIP_DIR_RE.test(f.path) && !SKIP_FILE_RE.test(f.path) && !BINARY_EXT_RE.test(f.path) && isProbablyText(f.data)
    )
    .map((f) => ({ path: f.path, text: decoder.decode(f.data), priority: filePriority(f.path) }))
    .sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path));

  if (textFiles.length === 0) {
    throw new IngestError("That repository has no readable text files to digest.");
  }

  const refLabel = repo.ref ? `@${repo.ref}` : "";
  const header = [
    `# Repository digest: ${repo.owner}/${repo.repo}${refLabel}`,
    "",
    `Source: https://github.com/${repo.owner}/${repo.repo}`,
    `Generated: ${generatedAt.toISOString().slice(0, 10)}`,
    `Text files found: ${textFiles.length}`,
    "",
    "This is a packed, single-document representation of the repository,",
    "ordered by importance (README, manifests, docs, then source).",
    "",
    "## Directory structure",
    "",
    "```",
    renderTree(textFiles.map((f) => f.path)),
    "```",
    "",
    "## Files",
    "",
  ].join("\n");

  const sections: string[] = [];
  let used = header.length;
  let included = 0;
  const separator = "=".repeat(48);
  for (const f of textFiles) {
    if (used >= DIGEST_BUDGET_CHARS) break;
    let body = f.text.trimEnd();
    if (body.length > PER_FILE_CHAR_CAP) {
      body = `${body.slice(0, PER_FILE_CHAR_CAP)}\n… [file truncated]`;
    }
    const section = `${separator}\nFile: ${f.path}\n${separator}\n${body}\n`;
    if (used + section.length > DIGEST_BUDGET_CHARS && included > 0) continue;
    sections.push(section);
    used += section.length;
    included++;
  }

  const omitted = textFiles.length - included;
  const footer = omitted > 0 ? `\n[${omitted} lower-priority file${omitted === 1 ? "" : "s"} omitted to fit the memory budget — the directory tree above lists everything.]` : "";

  return {
    title: `${repo.owner}/${repo.repo} — repository digest`,
    content: `${header}${sections.join("\n")}${footer}`,
    tags: ["github", repo.owner.toLowerCase(), repo.repo.toLowerCase()],
    fileCount: included,
  };
}

export async function digestGitHubRepo(repo: GitHubRepoRef): Promise<RepoDigest> {
  const ref = repo.ref ? encodeURIComponent(repo.ref) : "HEAD";
  const tarballUrl = `https://codeload.github.com/${repo.owner}/${repo.repo}/tar.gz/${ref}`;

  let res: Response;
  try {
    res = await fetch(tarballUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "HyperVaultBot/1.0 (+https://claudedamnit.com; repo digest)" },
    });
  } catch {
    throw new IngestError("Couldn't reach GitHub to download that repository.");
  }
  if (res.status === 404) {
    throw new IngestError(
      `Couldn't download ${repo.owner}/${repo.repo}${repo.ref ? `@${repo.ref}` : ""} — the repo may be private, or the branch doesn't exist. Only public repos can be digested.`,
      404
    );
  }
  if (!res.ok) {
    throw new IngestError(`GitHub responded with HTTP ${res.status} while downloading the repo.`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new IngestError("GitHub returned an empty download for that repo.");
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_TARBALL_BYTES) {
      void reader.cancel();
      throw new IngestError("That repository is too large to digest (over 30 MB compressed). Try a smaller repo.", 413);
    }
    chunks.push(value);
  }
  const compressed = Buffer.concat(chunks.map((c) => Buffer.from(c)));

  let tar: Buffer;
  try {
    tar = gunzipSync(compressed, { maxOutputLength: MAX_UNPACKED_BYTES });
  } catch {
    throw new IngestError("That repository is too large to digest, or the download was corrupted.", 413);
  }

  return buildRepoDigest(repo, parseTarEntries(new Uint8Array(tar)));
}
