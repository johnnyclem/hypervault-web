#!/usr/bin/env node

import { appendFile, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOG_PATH = process.argv[2] || process.env.STENOGRAPHER_LOG_PATH;
const CURSOR_FILE = process.env.EXPORT_CURSOR_FILE || (LOG_PATH ? `${LOG_PATH}.cursor` : null);
const BATCH = Number.parseInt(process.env.EXPORT_BATCH || "1000", 10);
const ROLES = new Set(["user", "assistant", "system", "tool"]);

if (!SUPABASE_URL || !SERVICE_KEY || !LOG_PATH) {
  console.error(
    "Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/stenographer-export.mjs <log-path>"
  );
  process.exit(1);
}

async function readCursor() {
  try {
    const raw = (await readFile(CURSOR_FILE, "utf8")).trim();
    return raw || "1970-01-01T00:00:00Z";
  } catch {
    return "1970-01-01T00:00:00Z";
  }
}

function toLine(row) {
  const digest = createHash("sha256").update(row.id).digest("hex").slice(0, 16);
  return `${JSON.stringify({
    id: `msg_${digest}`,
    role: row.role,
    content: row.content,
    timestamp: new Date(row.created_at).toISOString(),
    sessionId: row.conversation_id,
  })}\n`;
}

async function fetchPage(since, offset) {
  const params = new URLSearchParams({
    select: "id,conversation_id,role,content,created_at",
    created_at: `gt.${since}`,
    order: "created_at.asc,id.asc",
    limit: String(BATCH),
    offset: String(offset),
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/messages?${params}`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase read failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const since = await readCursor();
let offset = 0;
let exported = 0;
let latest = since;

for (;;) {
  const rows = await fetchPage(since, offset);
  if (!Array.isArray(rows) || rows.length === 0) break;
  const lines = rows
    .filter((r) => ROLES.has(r.role) && typeof r.content === "string" && r.content)
    .map(toLine)
    .join("");
  if (lines) await appendFile(LOG_PATH, lines, "utf8");
  exported += rows.length;
  latest = rows[rows.length - 1].created_at;
  if (rows.length < BATCH) break;
  offset += BATCH;
}

if (exported > 0) await writeFile(CURSOR_FILE, latest, "utf8");
console.log(`exported ${exported} messages (cursor: ${latest})`);
