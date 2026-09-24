/**
 * An event's structured location — the same fields on the create wizard
 * and the edit form (shared component: components/admin/fields/location-fields.tsx),
 * with the single `events.location` string composed from them so every place
 * that displays a location (cards, emails, calendar invites) keeps working.
 */
export type LocationFieldsValue = {
  venueName: string;
  streetAddress: string;
  city: string;
  state: string;
  /** Optional — some venues are informal meeting spots. */
  postalCode: string;
};

export const EMPTY_LOCATION: LocationFieldsValue = {
  venueName: "",
  streetAddress: "",
  city: "",
  state: "",
  postalCode: "",
};

/** "Denver, CO 80202" — or whichever of the three parts exist. */
export function cityStateZip(city: string | null, state: string | null, postalCode: string | null): string {
  const cityState = [city?.trim(), state?.trim()].filter(Boolean).join(", ");
  return [cityState, postalCode?.trim()].filter(Boolean).join(" ");
}

export function composeLocation(fields: LocationFieldsValue): string | null {
  const venue = fields.venueName.trim();
  const street = fields.streetAddress.trim();
  const parts = [venue, street, cityStateZip(fields.city, fields.state, fields.postalCode)].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

export function isLocationEmpty(fields: LocationFieldsValue): boolean {
  return ![fields.venueName, fields.streetAddress, fields.city, fields.state, fields.postalCode].some(
    (v) => v.trim(),
  );
}

/** US ZIP or ZIP+4 — every chapter is in the US. */
const POSTAL_CODE_PATTERN = /^\d{5}(-\d{4})?$/;

/**
 * The one validation rule both forms share: venue name, street address, city
 * and state are required; postal code is optional but must look like a ZIP
 * when given.
 *
 * `allowLegacyEmpty` is for editing an event created by hand before the
 * structured fields existed (it has only a free-text `location`): leaving all
 * of them blank is fine and keeps that text as-is, but filling in some means
 * filling in all the required ones.
 */
export function locationErrors(
  fields: LocationFieldsValue,
  options: { allowLegacyEmpty?: boolean } = {},
): string[] {
  if (options.allowLegacyEmpty && isLocationEmpty(fields)) return [];
  const errors: string[] = [];
  if (!fields.venueName.trim()) errors.push("Venue name is required");
  if (!fields.streetAddress.trim()) errors.push("Street address is required");
  if (!fields.city.trim()) errors.push("City is required");
  if (!fields.state.trim()) errors.push("State is required");
  if (fields.postalCode.trim() && !POSTAL_CODE_PATTERN.test(fields.postalCode.trim())) {
    errors.push("ZIP code should be 5 digits (or ZIP+4, like 80202-1234)");
  }
  return errors;
}
