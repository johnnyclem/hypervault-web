export const INVITE_COOKIE = "hv_invite_code";

export function adminEmails(): string[] {
  return (process.env.HYPERVAULT_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return Boolean(email) && adminEmails().includes(email!.trim().toLowerCase());
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateInviteCode(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  let chars = "";
  for (let i = 0; i < 8; i++) chars += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `HV-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export const REDEEM_MESSAGES: Record<string, string> = {
  invalid: "That invite code doesn't exist — double-check for typos.",
  disabled: "That invite code has been deactivated.",
  exhausted: "That invite code has already been used up.",
  not_authenticated: "Sign in first, then enter your invite code.",
};
