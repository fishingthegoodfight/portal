/**
 * The core profile: the minimum needed to run an event for someone — who
 * they are, how to reach them, which chapter, and who to call. Collected
 * once, not per event, and editable from the profile page afterwards.
 * Everything else (address, sizing, dietary, …) stays per event, through
 * the registration sections (lib/registration-sections.ts).
 *
 * Where each part is asked:
 *  - sign-up: name and phone (identity only — a short form for someone
 *    scanning a QR code to RSVP);
 *  - the RSVP form's "Your details" card: name, phone and chapter, whichever
 *    are still missing (shown only then). The emergency contact is its own
 *    always-required RSVP section, so it isn't asked twice;
 *  - walk-up: all of it, filling only what's blank on an existing profile.
 * Plain data, safe to import from client components.
 */

export const CORE_PROFILE_FIELDS = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "phone", label: "Phone" },
  { key: "chapter", label: "Home chapter" },
  { key: "emergency_contact", label: "Emergency contact name" },
  { key: "emergency_phone", label: "Emergency contact phone" },
] as const;
export type CoreProfileKey = (typeof CORE_PROFILE_FIELDS)[number]["key"];

/** The core fields the "Your details" card covers (the emergency contact
 * comes through its RSVP section). */
export const DETAILS_CARD_FIELDS = ["first_name", "last_name", "phone", "chapter"] as const satisfies readonly CoreProfileKey[];
export type DetailsCardKey = (typeof DETAILS_CARD_FIELDS)[number];

const blank = (value: unknown) => typeof value !== "string" || value.trim() === "";

/** Which core fields a profile row is missing, in CORE_PROFILE_FIELDS order. */
export function missingCoreFields(profile: Partial<Record<CoreProfileKey, unknown>> | null | undefined): CoreProfileKey[] {
  return CORE_PROFILE_FIELDS.map((f) => f.key).filter((key) => blank(profile?.[key]));
}

/** Which of the "Your details" card's fields a profile row is missing. */
export function missingDetailsFields(profile: Partial<Record<CoreProfileKey, unknown>> | null | undefined): DetailsCardKey[] {
  return DETAILS_CARD_FIELDS.filter((key) => blank(profile?.[key]));
}
