import { describe, expect, it } from "vitest";
import { refine } from "@/lib/vendor/smallchat/runtime/refinement";
import type { SelectorMatch } from "@/lib/vendor/smallchat/core/types";

describe("refine (heuristic fallback)", () => {
  const nearest: SelectorMatch[] = [
    { id: "77505f39-e60f-48e7-be24-1e85b4b1b449.list_tasks", distance: 0.55 },
    { id: "77505f39-e60f-48e7-be24-1e85b4b1b449.bulk_update_tasks", distance: 0.62 },
  ];

  it("produces human labels with no uuid and embeddable intents", async () => {
    const { refined, refinement } = await refine("list all tasks", nearest, []);
    expect(refined).toBe(true);
    const opts = refinement!.options;
    expect(opts[0].label).toBe("List Tasks");
    expect(opts[0].intent).toBe("list tasks");
    for (const o of opts) {
      expect(o.label).not.toMatch(/[0-9a-f-]{20,}/);
      expect(o.intent).not.toMatch(/[0-9a-f-]{20,}/);
    }
  });

  it("carries the canonical id so a pick can dispatch the exact tool", async () => {
    const { refinement } = await refine("list all tasks", nearest, []);
    expect(refinement!.options[0].canonical).toBe("77505f39-e60f-48e7-be24-1e85b4b1b449.list_tasks");
  });

  it("reports no refinement when there are no nearby tools", async () => {
    const { refined } = await refine("list all tasks", [], []);
    expect(refined).toBe(false);
  });
});
