import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { extractApiKey } from "@/lib/api-auth";

function reqWith(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/memory-repo/commits", { method: "POST", headers });
}

describe("extractApiKey", () => {
  it("reads the X-HyperVault-Key header directly", () => {
    expect(extractApiKey(reqWith({ "X-HyperVault-Key": "hv_abc_direct" }))).toBe("hv_abc_direct");
  });

  it("accepts an Authorization: Bearer hv_… token", () => {
    expect(extractApiKey(reqWith({ authorization: "Bearer hv_bearer_token-123" }))).toBe("hv_bearer_token-123");
  });

  it("is case-insensitive on the Bearer scheme", () => {
    expect(extractApiKey(reqWith({ authorization: "bearer hv_lower" }))).toBe("hv_lower");
  });

  it("ignores bearer tokens that are not hv_-prefixed (e.g. Supabase JWTs)", () => {
    expect(extractApiKey(reqWith({ authorization: "Bearer eyJhbGciOiJ.jwt.token" }))).toBeNull();
  });

  it("prefers the explicit header over a bearer token", () => {
    const key = extractApiKey(reqWith({ "X-HyperVault-Key": "hv_direct", authorization: "Bearer hv_bearer" }));
    expect(key).toBe("hv_direct");
  });

  it("returns null when neither header is present", () => {
    expect(extractApiKey(reqWith({}))).toBeNull();
  });
});
