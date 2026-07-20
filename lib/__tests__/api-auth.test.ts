import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { bearerToken, generateApiKey, hashKey } from "@/lib/api-auth";

function reqWith(headers: Record<string, string>): NextRequest {
  return new NextRequest("https://hypervault.store/api/capabilities", { headers });
}

describe("bearerToken", () => {
  it("extracts a token from a well-formed Authorization header", () => {
    expect(bearerToken(reqWith({ authorization: "Bearer abc.def.ghi" }))).toBe("abc.def.ghi");
  });

  it("is case-insensitive on the scheme", () => {
    expect(bearerToken(reqWith({ authorization: "bearer tok123" }))).toBe("tok123");
    expect(bearerToken(reqWith({ Authorization: "BEARER tok123" }))).toBe("tok123");
  });

  it("trims surrounding whitespace in the token", () => {
    expect(bearerToken(reqWith({ authorization: "Bearer   spaced.tok  " }))).toBe("spaced.tok");
  });

  it("returns null when there is no Authorization header", () => {
    expect(bearerToken(reqWith({}))).toBeNull();
  });

  it("returns null for a non-Bearer scheme (e.g. Basic)", () => {
    expect(bearerToken(reqWith({ authorization: "Basic dXNlcjpwYXNz" }))).toBeNull();
  });

  it("does not confuse an X-HyperVault-Key with a bearer token", () => {
    expect(bearerToken(reqWith({ "x-hypervault-key": "hv_something" }))).toBeNull();
  });
});

describe("api key format (unchanged by mobile auth work)", () => {
  it("mints hv_-prefixed keys whose hash is deterministic", () => {
    const { raw, hash, prefix } = generateApiKey();
    expect(raw.startsWith("hv_")).toBe(true);
    expect(prefix).toBe(raw.slice(0, 11));
    expect(hash).toBe(hashKey(raw));
    expect(hash).toHaveLength(64);
  });
});
