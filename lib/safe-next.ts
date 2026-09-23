/**
 * Where to send someone after sign-in / sign-up / email confirmation. Only
 * ever one of our own /protected/... paths — a bare prefix check keeps this
 * from becoming an open redirect via a `next` like "https://evil.example" or
 * "//evil.example" (neither starts with "/protected/"). Returns null for
 * anything else, so callers fall back to their default.
 */
export function safeNext(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/protected/") || value.includes("\\")) return null;
  return value;
}

/** The RSVP page a public event page's button leads to. */
export function rsvpPath(eventId: number): string {
  return `/protected/events/${eventId}/rsvp`;
}

/** `path` with ?next=<destination> appended (when there is one). */
export function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
