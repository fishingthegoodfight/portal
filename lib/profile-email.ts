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

/** Whether `text` looks like a complete email address (the same loose check
 * the lead picker and new-link form use). */
export function isEmailAddress(text: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(text));
}
