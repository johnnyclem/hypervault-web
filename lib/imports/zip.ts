import { unzip } from "fflate";


export type ZipExtractionStats = {
  totalEntries: number;
  jsonEntries: number;
  imageEntries: number;
  otherEntries: number;
  matchedEntryName: string | null;
};

export type ZipExtractionResult = {
  data: string;
  stats: ZipExtractionStats;
};

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg|tiff?)$/i;

export function extractConversationsFromZip(bytes: Uint8Array): Promise<ZipExtractionResult> {
  const stats: ZipExtractionStats = {
    totalEntries: 0,
    jsonEntries: 0,
    imageEntries: 0,
    otherEntries: 0,
    matchedEntryName: null,
  };

  return new Promise((resolve, reject) => {
    unzip(
      bytes,
      {
        filter: (file) => {
          if (file.name.endsWith("/")) return false;
          stats.totalEntries++;
          const lower = file.name.toLowerCase();
          if (lower.endsWith(".json")) {
            stats.jsonEntries++;
            return true;
          }
          if (IMAGE_EXT.test(lower)) stats.imageEntries++;
          else stats.otherEntries++;
          return false;
        },
      },
      (err, unzipped) => {
        if (err) return reject(err);
        resolve(pickConversationJson(unzipped, stats));
      }
    );
  });
}

function pickConversationJson(
  unzipped: Record<string, Uint8Array>,
  stats: ZipExtractionStats
): ZipExtractionResult {
  const decoder = new TextDecoder("utf-8");
  const candidates: { name: string; parsed: unknown; count: number }[] = [];

  for (const [name, entryBytes] of Object.entries(unzipped)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoder.decode(entryBytes));
    } catch {
      continue;
    }
    const count = conversationCount(parsed);
    if (count > 0) candidates.push({ name, parsed, count });
  }

  if (candidates.length === 0) return { data: "", stats };

  candidates.sort((a, b) => b.count - a.count);
  const winner = candidates[0];
  stats.matchedEntryName = winner.name;
  return { data: JSON.stringify(winner.parsed), stats };
}

function conversationCount(data: unknown): number {
  if (Array.isArray(data)) {
    return data.filter(
      (c) =>
        c &&
        typeof c === "object" &&
        ("responses" in c || "chat_messages" in c || "mapping" in c || "messages" in c)
    ).length;
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.conversations)) return conversationCount(obj.conversations);
  }
  return 0;
}
