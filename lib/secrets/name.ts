
export const SECRET_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

export const SECRET_NAME_HINT = "1–100 chars: letters, digits, dot, dash, or underscore.";

export function isValidSecretName(name: unknown): name is string {
  return typeof name === "string" && SECRET_NAME_RE.test(name);
}
