/**
 * The code page (/auth/code): where every "set or reset your password" and
 * "confirm your email" step happens, by typing a six-digit code that's
 * emailed only when the person asks for it there (lib/one-time-links.ts).
 * Plain data and URL building, safe in client components.
 *
 *  - setup:  first password for an account made for them (an invite, the
 *            import, a walk-up). Asks for the code and a new password.
 *  - reset:  "Forgot password". Same as setup, different words.
 *  - signup: confirming the email of an account they just made themselves.
 *            Code only; Supabase sends that code (Confirm signup template).
 */
export const CODE_MODES = ["setup", "reset", "signup"] as const;
export type CodeMode = (typeof CODE_MODES)[number];

export function isCodeMode(value: string | null | undefined): value is CodeMode {
  return (CODE_MODES as readonly string[]).includes(value ?? "");
}

/** /auth/code?mode=…&email=…&next=… — nothing secret in it, so it can sit
 * in an email for ever and a scanner opening it changes nothing. */
export function codePagePath({ mode, email, next }: { mode: CodeMode; email?: string | null; next?: string | null }): string {
  const params = new URLSearchParams({ mode });
  if (email) params.set("email", email);
  if (next) params.set("next", next);
  return `/auth/code?${params.toString()}`;
}
