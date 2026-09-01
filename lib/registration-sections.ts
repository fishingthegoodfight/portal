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

export type RegistrationFieldType = "text" | "tel" | "textarea";

export type RegistrationField = {
  /** Also the `profiles` column name that stores this field's value. */
  key: string;
  label: string;
  type: RegistrationFieldType;
  placeholder?: string;
  required?: boolean;
  /** Normalizes input as the user types, e.g. the phone mask. */
  format?: (value: string) => string;
};

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
    title: "Dietary notes",
    fields: [
      {
        key: "dietary_notes",
        label: "Dietary notes",
        type: "textarea",
        placeholder: "Allergies, preferences, etc. (optional)",
      },
    ],
    summary: (profileFields) => truncate(profileFields.dietary_notes ?? ""),
  },
];

/** Every profile column any section might read or write, deduped. */
export const REGISTRATION_PROFILE_FIELD_KEYS = Array.from(
  new Set(REGISTRATION_SECTIONS.flatMap((s) => s.fields.map((f) => f.key))),
);

export function isSectionComplete(
  section: RegistrationSection,
  profileFields: Record<string, string>,
): boolean {
  return section.fields.every((field) =>
    Boolean(profileFields[field.key]?.trim()),
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
