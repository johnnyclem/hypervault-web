import { describe, expect, it } from "vitest";
import {
  isMissingEmbeddingColumn,
  isStaleProviderConstraint,
} from "@/lib/backends/schema-compat";

describe("isMissingEmbeddingColumn", () => {
  it("matches PostgREST's schema-cache error on insert/update", () => {
    expect(
      isMissingEmbeddingColumn({
        code: "PGRST204",
        message: "Could not find the 'embedding_model' column of 'llm_backends' in the schema cache",
      })
    ).toBe(true);
  });

  it("matches Postgres 42703 on select", () => {
    expect(
      isMissingEmbeddingColumn({
        code: "42703",
        message: "column llm_backends.embedding_model does not exist",
      })
    ).toBe(true);
  });

  it("ignores unrelated errors, even ones mentioning columns", () => {
    expect(isMissingEmbeddingColumn(null)).toBe(false);
    expect(isMissingEmbeddingColumn({ code: "PGRST204", message: "Could not find the 'foo' column" })).toBe(false);
    expect(isMissingEmbeddingColumn({ code: "23505", message: "duplicate key value" })).toBe(false);
  });
});

describe("isStaleProviderConstraint", () => {
  it("matches the pre-0013 provider check violation", () => {
    expect(
      isStaleProviderConstraint({
        code: "23514",
        message: 'new row for relation "llm_backends" violates check constraint "llm_backends_provider_check"',
      })
    ).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isStaleProviderConstraint(null)).toBe(false);
    expect(isStaleProviderConstraint({ code: "PGRST204", message: "schema cache" })).toBe(false);
  });
});
