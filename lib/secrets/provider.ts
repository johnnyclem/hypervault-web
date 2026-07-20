
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "@/lib/backends/crypto";
import { isValidSecretName, SECRET_NAME_HINT, SECRET_NAME_RE } from "@/lib/secrets/name";

export type SecretKind = "opaque" | "header" | "oauth_grant";

export const SECRET_KINDS: SecretKind[] = ["opaque", "header", "oauth_grant"];

export { isValidSecretName, SECRET_NAME_HINT, SECRET_NAME_RE };

export type SecretRef = {
  secretId: string;
};

export interface SecretProvider {
  get(ref: SecretRef): Promise<string | null>;
  put(ref: SecretRef, value: string): Promise<void>;
}

export type SecretRow = {
  id: string;
  name: string;
  kind: SecretKind;
  description: string | null;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
};

export const SECRET_COLUMNS =
  "id, name, kind, description, created_at, updated_at, last_accessed_at";

export class LocalSecretProvider implements SecretProvider {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly userId: string
  ) {}

  async get(ref: SecretRef): Promise<string | null> {
    const { data } = await this.admin
      .from("user_secrets")
      .select("value_cipher")
      .eq("id", ref.secretId)
      .eq("user_id", this.userId)
      .maybeSingle();
    if (!data?.value_cipher) return null;
    return decryptSecret(data.value_cipher as string);
  }

  async put(ref: SecretRef, value: string): Promise<void> {
    const cipher = encryptSecret(value);
    if (!cipher) throw new Error("Encryption is not configured — cannot store secret.");
    await this.admin
      .from("user_secrets")
      .update({ value_cipher: cipher, updated_at: new Date().toISOString() })
      .eq("id", ref.secretId)
      .eq("user_id", this.userId);
  }

  async create(input: {
    name: string;
    value: string;
    kind?: SecretKind;
    description?: string | null;
  }): Promise<SecretRow> {
    const cipher = encryptSecret(input.value);
    if (!cipher) throw new Error("Encryption is not configured — cannot store secret.");
    const { data, error } = await this.admin
      .from("user_secrets")
      .insert({
        user_id: this.userId,
        name: input.name,
        value_cipher: cipher,
        kind: input.kind ?? "opaque",
        description: input.description ?? null,
      })
      .select(SECRET_COLUMNS)
      .single();
    if (error) throw error;
    return data as SecretRow;
  }
}

export async function loadSecretCipher(
  admin: SupabaseClient,
  userId: string,
  secretId: string
): Promise<string | null> {
  const { data } = await admin
    .from("user_secrets")
    .select("value_cipher")
    .eq("id", secretId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.value_cipher as string | undefined) ?? null;
}

export async function writeSecretCipher(
  admin: SupabaseClient,
  secretId: string,
  valueCipher: string
): Promise<void> {
  await admin
    .from("user_secrets")
    .update({ value_cipher: valueCipher, updated_at: new Date().toISOString() })
    .eq("id", secretId);
}
