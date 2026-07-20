import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { extractConversationsFromZip } from "@/lib/imports/zip";

describe("extractConversationsFromZip", () => {
  it("finds the conversation JSON among account/billing files and skips images", async () => {
    const zipped = zipSync({
      "prodmcauthmgmtapi.json": strToU8(JSON.stringify({ user: { email: "a@b.com" } })),
      "prodmcbilling.json": strToU8(JSON.stringify({ balance_map: { team1: 0 } })),
      "grok-conversations.json": strToU8(
        JSON.stringify([
          {
            conversation_id: "g1",
            title: "test",
            responses: [
              { sender: "human", message: "hi grok" },
              { sender: "grok", message: "hello human" },
            ],
          },
        ])
      ),
      "users/u1/photo.jpg": new Uint8Array([1, 2, 3, 4]),
      "users/u1/photo2.png": new Uint8Array([5, 6, 7, 8]),
    });

    const { data, stats } = await extractConversationsFromZip(zipped);

    expect(stats.matchedEntryName).toBe("grok-conversations.json");
    expect(stats.imageEntries).toBe(2);
    expect(stats.jsonEntries).toBe(3);

    const parsed = JSON.parse(data);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].responses).toHaveLength(2);
  });

  it("returns empty data when no JSON entry holds any conversations", async () => {
    const zipped = zipSync({
      "prodmcbilling.json": strToU8(JSON.stringify({ balance_map: { team1: 0 } })),
    });

    const { data, stats } = await extractConversationsFromZip(zipped);
    expect(data).toBe("");
    expect(stats.matchedEntryName).toBeNull();
  });
});
