import { describe, expect, it } from "vitest";
import {
  DREAM_CAP_TOTAL,
  findDreamConnections,
  pairKey,
  type ArtifactLite,
  type ExistingEdges,
  type MemoryLite,
} from "../dreaming";

const noEdges = (): ExistingEdges => ({
  artifactPairs: new Set(),
  memoryPairs: new Set(),
  memoryArtifactPairs: new Set(),
  proposed: new Set(),
});

describe("pairKey", () => {
  it("normalizes to a_id < b_id order", () => {
    expect(pairKey("b", "a")).toBe("a:b");
    expect(pairKey("a", "b")).toBe("a:b");
  });
});

describe("findDreamConnections — artifact↔artifact", () => {
  const artifacts: ArtifactLite[] = [
    { id: "a1", title: "Rust borrow checker notes", tags: ["rust"] },
    { id: "a2", title: "Rust lifetimes and the borrow checker", tags: ["rust"] },
    { id: "a3", title: "A sourdough recipe", tags: ["cooking"] },
  ];

  it("proposes a connection for tag + keyword overlap and skips unrelated pairs", () => {
    const dreams = findDreamConnections({ artifacts, memories: [], existing: noEdges() });
    expect(dreams).toHaveLength(1);
    expect(dreams[0]).toMatchObject({ edge_type: "artifact_artifact", a_id: "a1", b_id: "a2" });
    expect(dreams[0].score).toBeGreaterThan(0);
    expect(dreams[0].reason).toContain("rust");
  });

  it("never re-proposes an edge that already exists in the live graph", () => {
    const existing = noEdges();
    existing.artifactPairs.add(pairKey("a1", "a2"));
    expect(findDreamConnections({ artifacts, memories: [], existing })).toHaveLength(0);
  });

  it("never re-proposes a pair that was already staged (e.g. previously rejected)", () => {
    const existing = noEdges();
    existing.proposed.add("artifact_artifact:a1:a2");
    expect(findDreamConnections({ artifacts, memories: [], existing })).toHaveLength(0);
  });
});

describe("findDreamConnections — memory↔memory", () => {
  it("links memories that share tags/keywords, best score first", () => {
    const memories: MemoryLite[] = [
      { id: "m1", title: "Postgres indexing", summary: "GIN indexes speed up full text search", tags: ["postgres"] },
      { id: "m2", title: "Full text search in Postgres", summary: "tsvector and GIN indexes", tags: ["postgres"] },
      { id: "m3", title: "Weekend hiking plans", summary: "trail near the coast", tags: ["outdoors"] },
    ];
    const dreams = findDreamConnections({ artifacts: [], memories, existing: noEdges() });
    expect(dreams).toHaveLength(1);
    expect(dreams[0]).toMatchObject({ edge_type: "memory_memory", a_id: "m1", b_id: "m2" });
  });
});

describe("findDreamConnections — memory↔artifact bridges", () => {
  it("bridges a memory onto a related artifact with a_id=memory, b_id=artifact", () => {
    const memories: MemoryLite[] = [
      { id: "m1", title: "Notes on the tarot deck design", summary: "arcana layout and colors", tags: ["tarot", "design"] },
    ];
    const artifacts: ArtifactLite[] = [{ id: "a1", title: "Tarot deck generator", tags: ["tarot"] }];
    const dreams = findDreamConnections({ artifacts, memories, existing: noEdges() });
    const bridge = dreams.find((d) => d.edge_type === "memory_artifact");
    expect(bridge).toMatchObject({ a_id: "m1", b_id: "a1" });
  });

  it("respects an existing bridge (memoryId:artifactId key)", () => {
    const memories: MemoryLite[] = [
      { id: "m1", title: "Notes on the tarot deck design", summary: "arcana layout", tags: ["tarot"] },
    ];
    const artifacts: ArtifactLite[] = [{ id: "a1", title: "Tarot deck generator", tags: ["tarot"] }];
    const existing = noEdges();
    existing.memoryArtifactPairs.add("m1:a1");
    const dreams = findDreamConnections({ artifacts, memories, existing });
    expect(dreams.some((d) => d.edge_type === "memory_artifact")).toBe(false);
  });
});

describe("findDreamConnections — caps", () => {
  it("caps the total number of proposals per run", () => {
    const artifacts: ArtifactLite[] = Array.from({ length: 20 }, (_, i) => ({
      id: `a${i}`,
      title: `Rust note ${i}`,
      tags: ["rust"],
    }));
    const dreams = findDreamConnections({ artifacts, memories: [], existing: noEdges() });
    expect(dreams.length).toBeLessThanOrEqual(DREAM_CAP_TOTAL);
    expect(dreams.every((d) => d.edge_type === "artifact_artifact")).toBe(true);
  });

  it("sorts by score, highest first", () => {
    const memories: MemoryLite[] = [
      { id: "m1", title: "alpha beta", summary: "", tags: ["x", "y"] },
      { id: "m2", title: "alpha beta", summary: "", tags: ["x", "y"] },
      { id: "m3", title: "alpha gamma", summary: "", tags: [] },
    ];
    const dreams = findDreamConnections({ artifacts: [], memories, existing: noEdges() });
    for (let i = 1; i < dreams.length; i++) {
      expect(dreams[i - 1].score).toBeGreaterThanOrEqual(dreams[i].score);
    }
  });
});
