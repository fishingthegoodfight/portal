/**
 * Absolute origin for links sent outside the app (email, calendar invites).
 * Prefers an explicit NEXT_PUBLIC_SITE_URL (set this once the org's domain
 * is live) over Vercel's own deployment URL, and only falls back to
 * localhost while developing with neither set.
 */
export function getSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}
