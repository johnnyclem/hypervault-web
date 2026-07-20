import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";


function cipherKey(): Buffer | null {
  const secret = process.env.HYPERVAULT_KEY_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return createHash("sha256").update(secret).digest();
}

export function encryptionAvailable(): boolean {
  return cipherKey() !== null;
}

export function encryptSecret(plaintext: string): string | null {
  const key = cipherKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, encrypted, cipher.getAuthTag()]
    .map((b) => b.toString("base64url"))
    .join(".");
}

export function decryptSecret(payload: string): string | null {
  const key = cipherKey();
  if (!key) return null;
  const parts = payload.split(".");
  if (parts.length !== 3) return null;
  try {
    const [iv, ciphertext, tag] = parts.map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
