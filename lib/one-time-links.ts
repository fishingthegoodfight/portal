/**
 * How long a one-time account link lasts: the set-password links in the
 * volunteer and portal invites, and the "send me a new link" email. Each
 * works once.
 *
 * MUST MATCH the Supabase project's setting — Authentication > Sign In /
 * Providers > Email > "Email OTP Expiration", which is 86400 seconds = 24
 * hours (confirmed 2026-09-30). The app can't read that setting, so this is
 * only what the emails and pages SAY: change the setting and this together.
 * The sign-up confirmation and password reset emails are Supabase's own
 * templates (Authentication > Emails), so the same sentence has to be added
 * there by hand.
 */
export const ONE_TIME_LINK_LIFETIME = "24 hours";

/** The sentence every email carrying one of these links ends its link
 * paragraph with. An expired link's page (app/auth/error) offers a new one. */
export const ONE_TIME_LINK_NOTE = `This link works once and expires ${ONE_TIME_LINK_LIFETIME} after this email was sent. If it's expired by the time you get to it, click it anyway — the page will send you a new one.`;
