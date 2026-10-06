/** An email as profiles stores it: trimmed and lowercased. */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * The pattern for matching profiles.email with `.ilike("email", …)`: the
 * normalized email with `\`, `%` and `_` escaped so each matches only
 * itself. Unescaped, `john_smith@x.com` would also match
 * `john-smith@x.com`, a different person. Every lookup of a profile by
 * email goes through this.
 */
export function profileEmailPattern(email: string | null | undefined): string {
  return normalizeEmail(email).replace(/[\\%_]/g, (c) => `\\${c}`);
}
