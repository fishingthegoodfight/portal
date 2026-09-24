/**
 * Shared shapes for deleting admin setup items (volunteer role types, event
 * types, event templates) — each can only be deleted when nothing references
 * it; otherwise the admin is told exactly what's using it and offered
 * Deactivate instead. See the 2026-09-24 schema-changes.sql entry for the
 * database side of the same rule.
 */

/** One human-readable line per kind of reference, e.g. "used by 7 events".
 * Empty = nothing uses it, safe to delete. */
export type UsageResult = { ok: true; usage: string[] } | { ok: false; error: string };

export type DeleteResult =
  | { ok: true }
  /** `usage` is set when the delete was refused because something still
   * references the item (possibly something added since the usage check). */
  | { ok: false; error: string; usage?: string[] };

/** "1 event" / "7 events". */
export function countLabel(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}
