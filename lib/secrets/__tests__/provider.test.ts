import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.HYPERVAULT_KEY_SECRET = "test-secret-for-provider";
});

import { decryptSecret, encryptSecret } from "@/lib/backends/crypto";
import {
  isValidSecretName,
  LocalSecretProvider,
  loadSecretCipher,
  writeSecretCipher,
} from "@/lib/secrets/provider";

function makeAdmin() {
  const rows = new Map<string, Record<string, unknown>>();
  let seq = 0;
  const admin = {
    _rows: rows,
    from() {
      const filters: Record<string, unknown> = {};
      let pendingInsert: Record<string, unknown> | null = null;
      let pendingUpdate: Record<string, unknown> | null = null;
      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        insert(row: Record<string, unknown>) {
          pendingInsert = row;
          return builder;
        },
        update(patch: Record<string, unknown>) {
          pendingUpdate = patch;
          return builder;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return builder;
        },
        then(resolve: (v: { error: null }) => void) {
          if (pendingUpdate) {
            const id = filters.id as string;
            const existing = rows.get(id);
            if (existing && (filters.user_id === undefined || existing.user_id === filters.user_id)) {
              rows.set(id, { ...existing, ...pendingUpdate });
            }
          }
          resolve({ error: null });
        },
        async single() {
          const id = `secret-${++seq}`;
          const row = { id, ...pendingInsert } as Record<string, unknown>;
          if ([...rows.values()].some((r) => r.user_id === row.user_id && r.name === row.name)) {
            return { data: null, error: { code: "23505", message: "duplicate" } };
          }
          rows.set(id, row);
          return { data: row, error: null };
        },
        async maybeSingle() {
          for (const row of rows.values()) {
            if (Object.entries(filters).every(([k, v]) => row[k] === v)) {
              return { data: row, error: null };
            }
          }
          return { data: null, error: null };
        },
      };
      return builder;
    },
  };
  return admin as never as Parameters<typeof loadSecretCipher>[0] & { _rows: Map<string, Record<string, unknown>> };
}

describe("isValidSecretName", () => {
  it("accepts handles and rejects garbage", () => {
    expect(isValidSecretName("github-mcp-token")).toBe(true);
    expect(isValidSecretName("a.b_c-1")).toBe(true);
    expect(isValidSecretName("")).toBe(false);
    expect(isValidSecretName("has space")).toBe(false);
    expect(isValidSecretName("path/traversal")).toBe(false);
    expect(isValidSecretName("x".repeat(101))).toBe(false);
  });
});

describe("LocalSecretProvider", () => {
  it("round-trips a value: create encrypts, get decrypts", async () => {
    const admin = makeAdmin();
    const provider = new LocalSecretProvider(admin, "user-1");
    const secret = await provider.create({ name: "tok", value: "s3cr3t", kind: "opaque" });

    const stored = admin._rows.get(secret.id)!.value_cipher as string;
    expect(stored).not.toContain("s3cr3t");
    expect(decryptSecret(stored)).toBe("s3cr3t");

    expect(await provider.get({ secretId: secret.id })).toBe("s3cr3t");
    const other = new LocalSecretProvider(admin, "user-2");
    expect(await other.get({ secretId: secret.id })).toBeNull();
  });

  it("rejects a duplicate name with a 23505", async () => {
    const admin = makeAdmin();
    const provider = new LocalSecretProvider(admin, "user-1");
    await provider.create({ name: "dupe", value: "a" });
    await expect(provider.create({ name: "dupe", value: "b" })).rejects.toMatchObject({ code: "23505" });
  });

  it("put() rotates the stored value", async () => {
    const admin = makeAdmin();
    const provider = new LocalSecretProvider(admin, "user-1");
    const secret = await provider.create({ name: "rot", value: "old" });
    await provider.put({ secretId: secret.id }, "new");
    expect(await provider.get({ secretId: secret.id })).toBe("new");
  });
});

describe("loadSecretCipher / writeSecretCipher", () => {
  it("loads the raw cipher for the owner and writes a rotation back", async () => {
    const admin = makeAdmin();
    const provider = new LocalSecretProvider(admin, "user-1");
    const secret = await provider.create({ name: "grant", value: "v1" });

    const cipher = await loadSecretCipher(admin, "user-1", secret.id);
    expect(cipher).toBeTruthy();
    expect(decryptSecret(cipher!)).toBe("v1");

    expect(await loadSecretCipher(admin, "user-2", secret.id)).toBeNull();

    const rotated = encryptSecret("v2")!;
    await writeSecretCipher(admin, secret.id, rotated);
    expect(decryptSecret((await loadSecretCipher(admin, "user-1", secret.id))!)).toBe("v2");
  });
});
