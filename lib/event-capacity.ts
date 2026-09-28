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

/** At or below this many spots left, participant-facing pages show the count. */
export const SCARCITY_THRESHOLD = 5;

/**
 * Spots left as participants and the public see it: "3 spots left" only once
 * there are SCARCITY_THRESHOLD or fewer, so an empty event never reads
 * "20 spots left" and puts off the first person to sign up. null above that
 * (and for unlimited). Full is the caller's to say — it comes with the
 * waitlist. Admin views show the real numbers and don't use this.
 */
export function scarcitySpotsLabel(spotsLeft: number | null): string | null {
  if (spotsLeft == null || spotsLeft <= 0 || spotsLeft > SCARCITY_THRESHOLD) return null;
  return `${spotsLeft} ${spotsLeft === 1 ? "spot" : "spots"} left`;
}
