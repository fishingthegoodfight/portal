/**
 * Sign-in codes. No email that arrives unasked carries a credential: mail
 * scanners (Gmail, Outlook Safe Links, corporate filters) open links before
 * the person does, which used up the old one-time links. Invites, the
 * walk-up welcome and "Forgot password" all send people to the code page
 * (/auth/code), and a six-digit code is emailed only when they press "Send
 * me a code" there — so it arrives while they're at the screen. See
 * lib/access-codes.ts.
 *
 * MUST MATCH the Supabase project's setting — Authentication > Sign In /
 * Providers > Email > "Email OTP Expiration": 3600 seconds = 1 hour (set
 * 2026-10-08). The app can't read that setting, so this is only what the
 * emails and pages SAY: change the setting and this together. It also
 * covers the sign-up confirmation code, which Supabase sends itself
 * (Authentication > Emails > Confirm signup, using {{ .Token }}).
 */
export const CODE_LIFETIME = "1 hour";

/** Minutes between two codes to the same address from "Send me a code". */
export const CODE_MIN_GAP_MINUTES = 2;
