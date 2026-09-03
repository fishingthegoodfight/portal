import { formatPhoneNumber } from "@/lib/phone";

/**
 * Catalog of optional RSVP registration sections — e.g. dietary notes today,
 * sizing or a waiver signature later. Each section is profile-backed: its
 * fields map 1:1 to columns on `profiles`, so once a value is on file it's
 * never asked again on a future RSVP, the same way emergency contact already
 * worked.
 *
 * To add a new section: add its profile column(s) via a schema-changes.sql
 * migration, then add an entry below. Nothing else in the RSVP form needs to
 * change — it renders this catalog generically.
 */

export type RegistrationFieldType = "text" | "tel" | "textarea" | "yesno";

export type RegistrationField = {
  /** Also the `profiles` column name that stores this field's value. */
  key: string;
  label: string;
  type: RegistrationFieldType;
  placeholder?: string;
  /**
   * Whether this field must have a value for the section to count as complete
   * (and to allow the RSVP). The catalog is the single source of truth here —
   * `isSectionComplete` and the RSVP form's submit gate both read it — so a
   * future section can freely mix required and optional fields.
   */
  required?: boolean;
  /** Normalizes input as the user types, e.g. the phone mask. */
  format?: (value: string) => string;
};

/**
 * Sentinel stored in `profiles.dietary_notes` when a member answers "No" to
 * "Any dietary restrictions?". Keeping an explicit value on file (rather than
 * leaving the column empty) is what lets the section count as complete, so a
 * later RSVP doesn't ask again — no separate boolean column needed.
 */
export const DIETARY_NONE = "None";

export type RegistrationSection = {
  id: string;
  title: string;
  /** Collected on every RSVP regardless of the event's registration_sections. */
  alwaysRequired?: boolean;
  fields: RegistrationField[];
  /** One-line "On file" summary shown once the section is already complete. */
  summary: (profileFields: Record<string, string>) => string;
};

function truncate(value: string, max = 60): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export const REGISTRATION_SECTIONS: RegistrationSection[] = [
  {
    id: "emergency_contact",
    title: "Emergency contact",
    alwaysRequired: true,
    fields: [
      { key: "emergency_contact", label: "Name", type: "text", required: true },
      {
        key: "emergency_phone",
        label: "Phone",
        type: "tel",
        placeholder: "(303) 555-0100",
        required: true,
        format: formatPhoneNumber,
      },
    ],
    summary: (profileFields) =>
      [profileFields.emergency_contact, profileFields.emergency_phone]
        .filter(Boolean)
        .join(" · "),
  },
  {
    id: "dietary",
    title: "Any dietary restrictions?",
    fields: [
      {
        // A single backing column holds three states:
        //   ""            → not answered yet
        //   DIETARY_NONE  → answered "No"
        //   any other text → answered "Yes", the text being the details
        key: "dietary_notes",
        label: "What should we know?",
        type: "yesno",
        placeholder: "Allergies, medical needs, preferences…",
        required: true,
      },
    ],
    summary: (profileFields) => {
      const value = (profileFields.dietary_notes ?? "").trim();
      return value === DIETARY_NONE ? "No dietary restrictions" : truncate(value);
    },
  },
];

/** Every profile column any section might read or write, deduped. */
export const REGISTRATION_PROFILE_FIELD_KEYS = Array.from(
  new Set(REGISTRATION_SECTIONS.flatMap((s) => s.fields.map((f) => f.key))),
);

/**
 * True once the member has entered *anything* for this section — even a
 * partial answer. The profile page uses this to decide whether an optional
 * section is worth surfacing as its own card at all; a never-answered section
 * only appears once an RSVP that requires it collects it.
 */
export function isSectionAnswered(
  section: RegistrationSection,
  profileFields: Record<string, string>,
): boolean {
  return section.fields.some((field) =>
    Boolean(profileFields[field.key]?.trim()),
  );
}

/**
 * A section is complete once every field the catalog marks `required` has a
 * value on file. Optional fields never block completeness.
 */
export function isSectionComplete(
  section: RegistrationSection,
  profileFields: Record<string, string>,
): boolean {
  return section.fields.every(
    (field) => !field.required || Boolean(profileFields[field.key]?.trim()),
  );
}

/** The sections that apply to a given event: always-required ones plus
 * whichever optional ones are listed in that event's `registration_sections`. */
export function sectionsForEvent(
  registrationSections: string[] | null | undefined,
): RegistrationSection[] {
  const active = new Set(registrationSections ?? []);
  return REGISTRATION_SECTIONS.filter(
    (section) => section.alwaysRequired || active.has(section.id),
  );
}
