/**
 * An event's structured location — the same four fields on the create wizard
 * and the edit form (shared component: components/admin/fields/location-fields.tsx),
 * with the single `events.location` string composed from them so every place
 * that displays a location (cards, emails, calendar invites) keeps working.
 */
export type LocationFieldsValue = {
  venueName: string;
  streetAddress: string;
  city: string;
  state: string;
};

export function composeLocation(fields: LocationFieldsValue): string | null {
  const venue = fields.venueName.trim();
  const street = fields.streetAddress.trim();
  const cityState = [fields.city.trim(), fields.state.trim()].filter(Boolean).join(", ");
  const parts = [venue, street, cityState].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function isLocationEmpty(fields: LocationFieldsValue): boolean {
  return ![fields.venueName, fields.streetAddress, fields.city, fields.state].some((v) =>
    v.trim(),
  );
}

/**
 * The one validation rule both forms share: venue name, street address, city
 * and state are all required.
 *
 * `allowLegacyEmpty` is for editing an event created by hand before the
 * structured fields existed (it has only a free-text `location`): leaving all
 * four blank is fine and keeps that text as-is, but filling in some means
 * filling in all.
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
  return errors;
}
