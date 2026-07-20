import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { starRepo, verifyWebhookSignature } from "@/lib/github";

function sign(body: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifyWebhookSignature", () => {
  const secret = "shhh";
  const body = JSON.stringify({ action: "created", sender: { id: 1, login: "octocat" } });

  it("accepts a correctly signed payload", () => {
    expect(verifyWebhookSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyWebhookSignature(body + " ", sign(body, secret), secret)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyWebhookSignature(body, sign(body, "nope"), secret)).toBe(false);
  });

  it("rejects a missing or empty signature", () => {
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyWebhookSignature(body, "", secret)).toBe(false);
  });

  it("rejects a malformed signature of the wrong length", () => {
    expect(verifyWebhookSignature(body, "sha256=abc", secret)).toBe(false);
  });

  it("rejects when the secret is empty", () => {
    expect(verifyWebhookSignature(body, sign(body, ""), "")).toBe(false);
  });
});

describe("starRepo", () => {
  const original = process.env.GITHUB_STAR_REPO;
  afterEach(() => {
    if (original === undefined) delete process.env.GITHUB_STAR_REPO;
    else process.env.GITHUB_STAR_REPO = original;
  });

  it("defaults to the HyperVault repo", () => {
    delete process.env.GITHUB_STAR_REPO;
    expect(starRepo()).toBe("johnnyclem/hypervault");
  });

  it("honors an override and trims it", () => {
    process.env.GITHUB_STAR_REPO = "  acme/widgets  ";
    expect(starRepo()).toBe("acme/widgets");
  });
});
