/**
 * Public event URLs: /events/<slug>, e.g. /events/knot-just-fly-tying-night-oct-2-a1b2.
 * The database generates a slug for every new event and never changes it on
 * its own (see the 2026-09-23 "Public event pages" schema-changes.sql entry);
 * an admin can change it on the edit form, and the old one keeps redirecting.
 * These rules mirror the events_slug_format constraint — keep them in sync.
 */

export const SLUG_MAX_LENGTH = 80;

/** What an admin typed, made URL-safe: lowercase, runs of anything else
 * become a single "-", no leading/trailing "-". */
export function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Why a (normalized) slug isn't allowed, or null if it is. */
export function slugError(slug: string): string | null {
  if (slug.length < 3) return "The link needs at least 3 characters";
  if (slug.length > SLUG_MAX_LENGTH) return `The link can be at most ${SLUG_MAX_LENGTH} characters`;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return "Use only lowercase letters, numbers, and single dashes";
  }
  // All-digit paths are reserved for old /events/<id> links.
  if (!/[a-z]/.test(slug)) return "The link needs at least one letter";
  return null;
}

export function publicEventPath(slug: string): string {
  return `/events/${slug}`;
}
