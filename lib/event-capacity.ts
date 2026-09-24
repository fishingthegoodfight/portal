/**
 * Capacity as typed on the event forms: blank means unlimited (stored as
 * NULL), otherwise a whole number of at least 1. One rule for the create
 * wizard and the edit form.
 */
export function parseCapacity(raw: string): number | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : Number(trimmed);
}

export function capacityError(raw: string): string | null {
  const capacity = parseCapacity(raw);
  if (capacity == null) return null;
  if (!Number.isInteger(capacity) || capacity < 1) {
    return "Capacity must be a whole number of at least 1, or blank for unlimited";
  }
  return null;
}

/**
 * Spots left on an event — THE rule for every screen, matching the
 * database's try_claim_event_spot: null capacity = unlimited (returns null),
 * a missing spots_taken counts as 0. `taken` should already include open
 * waitlist offers wherever the caller has them. Can go negative when an
 * admin confirmed walk-ups over capacity; callers treat <= 0 as full.
 */
export function spotsLeft(capacity: number | null, taken: number | null): number | null {
  return capacity == null ? null : capacity - (taken ?? 0);
}
