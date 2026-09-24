import type { LocationFieldsValue } from "@/lib/event-location";

/**
 * Saved venues (table `venues`, see the 2026-09-24 "Saved venues"
 * schema-changes.sql entry) — a picker on the event create/edit forms and
 * templates that fills in the address fields. Picking one only ever COPIES
 * its address onto the event: events keep their own venue_name /
 * street_address / city / state / postal_code, never a reference to the
 * venue row, so editing, retiring or deleting a venue never changes an
 * event, past or future.
 */
export type Venue = {
  id: number;
  name: string;
  street_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  /** Null = offered to every chapter. */
  chapter: string | null;
  active: boolean;
};

export const VENUE_COLUMNS = "id, name, street_address, city, state, postal_code, chapter, active";

export function venueToLocation(venue: Venue): LocationFieldsValue {
  return {
    venueName: venue.name,
    streetAddress: venue.street_address ?? "",
    city: venue.city ?? "",
    state: venue.state ?? "",
    postalCode: venue.postal_code ?? "",
  };
}

/** A chapter's own venues plus the all-chapter ones, or every venue when
 * `chapter` is empty (nothing chosen yet, or a template for all chapters). */
export function venuesForChapter(venues: Venue[], chapter: string | null | undefined): Venue[] {
  if (!chapter) return venues;
  return venues.filter((v) => v.chapter === null || v.chapter === chapter);
}

/** The saved venue with exactly this name (ignoring case and surrounding
 * spaces) among `venues`, if any. */
export function findVenueByName(venues: Venue[], name: string): Venue | undefined {
  const key = name.trim().toLowerCase();
  if (!key) return undefined;
  return venues.find((v) => v.name.trim().toLowerCase() === key);
}

/** "123 Main St, Denver, CO 80202" — the one-line address under a venue's
 * name in the picker and on the Setup list. */
export function venueAddressLine(venue: Venue): string {
  const cityStateZip = [
    [venue.city, venue.state].filter((p) => p?.trim()).join(", "),
    venue.postal_code?.trim(),
  ]
    .filter(Boolean)
    .join(" ");
  return [venue.street_address?.trim(), cityStateZip].filter(Boolean).join(", ");
}
