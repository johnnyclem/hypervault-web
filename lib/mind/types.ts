
export type MindOp = "create" | "update" | "delete";

export type MemorySnapshot = {
  memory_id: string;
  title: string;
  content: string;
  summary: string;
  tags: string[];
  source: string;
};

export type MemoryState = Map<string, MemorySnapshot>;

export type MindChange = MemorySnapshot & { op: MindOp };

export type LinkChange = {
  a_id: string;
  b_id: string;
  op: "add" | "remove";
  kind: "manual" | "auto";
};

export type LinkKey = string;

export type LinkState = Map<LinkKey, "manual" | "auto">;

export type MergeConflict = {
  memory_id: string;
  base?: MemorySnapshot;
  ours?: MemorySnapshot;
  theirs?: MemorySnapshot;
};

export type MergeResolution = {
  memory_id: string;
  resolution: "ours" | "theirs" | { title: string; content: string; tags?: string[] };
};

export type CommitRow = {
  id: string;
  parent_commit_id: string | null;
  merge_parent_commit_id: string | null;
  created_at?: string;
};

export type RevisionRow = MemorySnapshot & {
  id: string;
  commit_id: string;
  op: MindOp;
  created_at?: string;
};

export type LinkChangeRow = LinkChange & { commit_id: string };

export type ProvenanceReceipt = {
  commit_id: string;
  message: string;
  author_kind: "user" | "agent" | "system";
  author_key_prefix?: string;
  committed_at: string;
};

export function linkKey(a: string, b: string): LinkKey {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function splitLinkKey(key: LinkKey): { a_id: string; b_id: string } {
  const [a_id, b_id] = key.split(":");
  return { a_id, b_id };
}
