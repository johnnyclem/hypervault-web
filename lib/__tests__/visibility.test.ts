import { describe, expect, it } from "vitest";
import {
  artifactRefColumn,
  canViewArtifact,
  escapeLikePattern,
  isMissingColumnError,
  isMissingTableError,
  isPrivateArtifact,
  normalizeVisibility,
} from "@/lib/visibility";

const OWNER = "11111111-1111-1111-1111-111111111111";
const FRIEND = "22222222-2222-2222-2222-222222222222";
const STRANGER = "33333333-3333-3333-3333-333333333333";

describe("normalizeVisibility", () => {
  it("passes through valid values", () => {
    expect(normalizeVisibility("public")).toBe("public");
    expect(normalizeVisibility("private")).toBe("private");
  });

  it("falls back to private for anything else (new saves default private)", () => {
    expect(normalizeVisibility(undefined)).toBe("private");
    expect(normalizeVisibility(null)).toBe("private");
    expect(normalizeVisibility("PUBLIC")).toBe("private");
    expect(normalizeVisibility(42)).toBe("private");
  });

  it("honors an explicit fallback", () => {
    expect(normalizeVisibility(undefined, "public")).toBe("public");
  });
});

describe("isPrivateArtifact", () => {
  it("treats missing visibility as public (pre-0016 rows keep working)", () => {
    expect(isPrivateArtifact({})).toBe(false);
    expect(isPrivateArtifact({ visibility: null })).toBe(false);
    expect(isPrivateArtifact({ visibility: undefined })).toBe(false);
  });

  it("flags private rows", () => {
    expect(isPrivateArtifact({ visibility: "private" })).toBe(true);
    expect(isPrivateArtifact({ visibility: "public" })).toBe(false);
  });
});

describe("canViewArtifact", () => {
  it("lets anyone view a public artifact", () => {
    const artifact = { user_id: OWNER, visibility: "public" };
    expect(canViewArtifact(artifact, null)).toBe(true);
    expect(canViewArtifact(artifact, STRANGER)).toBe(true);
  });

  it("lets anyone view a legacy artifact with no visibility", () => {
    expect(canViewArtifact({ user_id: OWNER }, null)).toBe(true);
  });

  it("blocks anonymous viewers from private artifacts", () => {
    expect(canViewArtifact({ user_id: OWNER, visibility: "private" }, null)).toBe(false);
  });

  it("lets the owner view their private artifact", () => {
    expect(canViewArtifact({ user_id: OWNER, visibility: "private" }, OWNER)).toBe(true);
  });

  it("lets an invited user view a private artifact", () => {
    expect(canViewArtifact({ user_id: OWNER, visibility: "private" }, FRIEND, true)).toBe(true);
  });

  it("blocks signed-in users who weren't invited", () => {
    expect(canViewArtifact({ user_id: OWNER, visibility: "private" }, STRANGER, false)).toBe(false);
  });
});

describe("isMissingColumnError", () => {
  it("matches the PostgREST schema-cache message", () => {
    const error = { message: "Could not find the 'visibility' column of 'artifacts' in the schema cache" };
    expect(isMissingColumnError(error, "visibility")).toBe(true);
  });

  it("matches the raw Postgres message", () => {
    const error = { message: "column artifacts.visibility does not exist" };
    expect(isMissingColumnError(error, "visibility")).toBe(true);
  });

  it("matches on the PostgREST/Postgres error codes", () => {
    expect(isMissingColumnError({ code: "PGRST204", message: "visibility" }, "visibility")).toBe(true);
    expect(isMissingColumnError({ code: "42703", message: "visibility" }, "visibility")).toBe(true);
  });

  it("ignores unrelated errors and missing errors", () => {
    expect(isMissingColumnError({ message: "duplicate key value" }, "visibility")).toBe(false);
    expect(isMissingColumnError(null, "visibility")).toBe(false);
    expect(isMissingColumnError({ message: "column artifacts.slug does not exist" }, "visibility")).toBe(false);
  });
});

describe("artifactRefColumn", () => {
  it("routes UUIDs to id and everything else to slug", () => {
    expect(artifactRefColumn("11111111-1111-1111-1111-111111111111")).toBe("id");
    expect(artifactRefColumn("my-cool-artifact")).toBe("slug");
    expect(artifactRefColumn("11111111-1111-1111-1111-11111111111")).toBe("slug");
  });
});

describe("escapeLikePattern", () => {
  it("escapes ILIKE metacharacters so emails match literally", () => {
    expect(escapeLikePattern("jo_n@example.com")).toBe("jo\\_n@example.com");
    expect(escapeLikePattern("a%b@example.com")).toBe("a\\%b@example.com");
    expect(escapeLikePattern("back\\slash@example.com")).toBe("back\\\\slash@example.com");
    expect(escapeLikePattern("plain@example.com")).toBe("plain@example.com");
  });
});

describe("isMissingTableError", () => {
  it("matches the raw Postgres message", () => {
    const error = { message: 'relation "public.artifact_shares" does not exist' };
    expect(isMissingTableError(error, "artifact_shares")).toBe(true);
  });

  it("matches the PostgREST schema-cache message", () => {
    const error = { message: "Could not find the table 'public.artifact_shares' in the schema cache" };
    expect(isMissingTableError(error, "artifact_shares")).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isMissingTableError({ message: "permission denied for table artifact_shares" }, "connections")).toBe(
      false
    );
    expect(isMissingTableError(null, "artifact_shares")).toBe(false);
  });
});
