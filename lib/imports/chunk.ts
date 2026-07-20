// Vercel's Node.js serverless functions hard-cap request bodies at 4.5 MB —
// a limit /api/import can't see or override. Grok/X account exports commonly
// bundle every conversation into one JSON file well past that, so large
// imports get split into several sub-4.5MB POSTs instead of one giant one.
const DEFAULT_MAX_BYTES = 3_500_000;

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Splits a raw export payload (JSON array of conversations, or
 * `{ conversations: [...] }`) into JSON-array strings that each stay under
 * `maxBytes`. Falls back to `[raw]` untouched when the payload is already
 * small, isn't JSON, or isn't an array of multiple conversations.
 */
export function chunkImportPayload(raw: string, maxBytes: number = DEFAULT_MAX_BYTES): string[] {
  const trimmed = raw.trim();
  if (!trimmed || byteLength(trimmed) <= maxBytes) return [raw];

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return [raw];
  }

  let items: unknown[];
  if (Array.isArray(data)) {
    items = data;
  } else if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as Record<string, unknown>).conversations)
  ) {
    items = (data as Record<string, unknown>).conversations as unknown[];
  } else {
    return [raw];
  }
  if (items.length <= 1) return [raw];

  const chunks: string[] = [];
  let current: unknown[] = [];
  let currentBytes = 2; // "[]"

  for (const item of items) {
    const itemBytes = byteLength(JSON.stringify(item)) + 1; // +1 for separator
    if (current.length > 0 && currentBytes + itemBytes > maxBytes) {
      chunks.push(JSON.stringify(current));
      current = [];
      currentBytes = 2;
    }
    current.push(item);
    currentBytes += itemBytes;
  }
  if (current.length > 0) chunks.push(JSON.stringify(current));

  return chunks.length > 0 ? chunks : [raw];
}
