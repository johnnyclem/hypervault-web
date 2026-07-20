import { afterEach, describe, expect, it } from "vitest";
import {
  publicServer,
  resetVaultColumnCache,
  serverColumns,
  withVaultColumns,
} from "@/lib/smallchat/server-rows";

function makeProbe(probeResult: { error: unknown }) {
  let probes = 0;
  const admin = {
    from() {
      return {
        select() {
          return this;
        },
        limit() {
          probes += 1;
          return Promise.resolve(probeResult);
        },
      };
    },
    probeCount: () => probes,
  } as never as { probeCount: () => number } & Record<string, unknown>;
  return admin;
}

afterEach(() => resetVaultColumnCache());

describe("serverColumns / withVaultColumns", () => {
  it("includes the vault reference columns when the database has them", async () => {
    const admin = makeProbe({ error: null });
    const cols = await serverColumns(admin as never);
    expect(cols).toContain("auth_headers_secret_id");
    expect(cols).toContain("oauth_grant_secret_id");
  });

  it("drops the vault columns on a pre-0023 database (Postgres 42703)", async () => {
    const admin = makeProbe({
      error: { code: "42703", message: "column mcp_servers.auth_headers_secret_id does not exist" },
    });
    const cols = await serverColumns(admin as never);
    expect(cols).not.toContain("auth_headers_secret_id");
    expect(cols).not.toContain("oauth_grant_secret_id");
    expect(cols).toContain("auth_headers_cipher");
    expect(cols).toContain("oauth_grant_cipher");
  });

  it("drops the vault columns on PostgREST's schema-cache variant (PGRST204)", async () => {
    const admin = makeProbe({
      error: {
        code: "PGRST204",
        message: "Could not find the 'auth_headers_secret_id' column of 'mcp_servers' in the schema cache",
      },
    });
    expect(await serverColumns(admin as never)).not.toContain("secret_id");
  });

  it("appends the vault columns to a caller-supplied base list", async () => {
    const admin = makeProbe({ error: null });
    const cols = await withVaultColumns("id, user_id, auth_headers_cipher, oauth_grant_cipher", admin as never);
    expect(cols).toBe(
      "id, user_id, auth_headers_cipher, oauth_grant_cipher, auth_headers_secret_id, oauth_grant_secret_id"
    );
  });

  it("probes the database only once and caches the verdict", async () => {
    const admin = makeProbe({ error: null });
    await serverColumns(admin as never);
    await serverColumns(admin as never);
    await withVaultColumns("id", admin as never);
    expect(admin.probeCount()).toBe(1);
  });
});

describe("publicServer tolerates rows without the vault columns", () => {
  it("shapes a pre-0023 row (no *_secret_id keys) without crashing", () => {
    const shaped = publicServer({
      id: "s1",
      name: "example",
      url: "https://mcp.test/mcp",
      auth_headers_cipher: null,
      oauth_grant_cipher: "iv.ct.tag",
    });
    expect(shaped.has_auth).toBe(true);
    expect(shaped.secret_backed).toBe(false);
    expect(shaped.auth_type).toBe("oauth");
    expect("oauth_grant_cipher" in shaped).toBe(false);
  });
});
