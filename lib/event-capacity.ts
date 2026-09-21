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
