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
 * change — it renders this catalog generically. If any of its fields are
 * required, ALSO add them to registration_incomplete_section in the same
 * migration: rsvp_to_event and the volunteer signup functions check
 * completeness in the database with that SQL mirror of this catalog (see
 * the 2026-09-23 "Every user-callable function" schema-changes.sql entry).
 */

export type RegistrationFieldType =
  | "text"
  | "tel"
  | "textarea"
  | "yesno"
  | "checkbox"
  /** A dropdown of `options`; stored as text, NULL until chosen. */
  | "select"
  /** A required-able Yes/No backed by a nullable boolean column — held as
   * "true" / "false" / "" (unanswered) in form state. Unlike "checkbox",
   * "not answered" is a real state. */
  | "yesno_bool";

export type RegistrationField = {
  /** Also the `profiles` column name that stores this field's value. */
  key: string;
  label: string;
  type: RegistrationFieldType;
  placeholder?: string;
  /** Explanatory text shown under the input (checkbox and yesno fields). */
  helpText?: string;
  /**
   * Whether this field must have a value for the section to count as complete
   * (and to allow the RSVP). The catalog is the single source of truth here —
   * `isSectionComplete` and the RSVP form's submit gate both read it — so a
   * future section can freely mix required and optional fields.
   */
  required?: boolean;
  /** Normalizes input as the user types, e.g. the phone mask. */
  format?: (value: string) => string;
  /** Choices for a "select" field. */
  options?: { value: string; label: string }[];
  /**
   * Only shown — and only required, if `required` — while another field in
   * the same section holds this value (e.g. boot size once "needs boots" is
   * Yes). A hidden field's stored value is cleared on save.
   */
  showWhen?: { key: string; equals: string };
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
  /**
   * A setting the member must always be able to see and change, rather than
   * data collected once. Never collapses to the "On file" summary on the RSVP
   * form, always shows as an open card on the profile page, and is re-saved
   * on every RSVP that includes it.
   */
  alwaysEditable?: boolean;
  /** "stack" lays fields out in one column (for sections with conditional
   * fields, where a two-column grid would leave holes). */
  layout?: "stack";
  /**
   * The liability waiver isn't profile-backed: a signature is stored per
   * (user, waiver) in `waiver_signatures` and can never be edited, so this
   * section has no `fields`, never appears on the profile page, and is
   * rendered by its own component on the RSVP and walk-up forms.
   */
  kind?: "waiver";
  /**
   * A standing preference that lives on the profile (and the sign-up flow),
   * never a per-event choice: excluded from `sectionsForEvent` and from the
   * admin event forms' section pickers. (Participant directory.)
   */
  profileOnly?: boolean;
  fields: RegistrationField[];
  /** One-line "On file" summary shown once the section is already complete. */
  summary: (profileFields: Record<string, string>) => string;
};

export const FLY_FISHING_EXPERIENCE = ["None", "Beginner", "Intermediate", "Advanced"] as const;
export const WADER_SIZES = ["S", "M", "L", "XL", "XXL"] as const;
/** US men's 6 through 15, including half sizes. */
export const BOOT_SIZES: string[] = Array.from({ length: 19 }, (_, i) =>
  String(6 + i * 0.5),
);

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
      // Optional here (so every RSVP's completeness check is unchanged);
      // the health form requires all of them and saves them back here.
      { key: "emergency_contact_relationship", label: "Relationship", type: "text", placeholder: "e.g. Spouse" },
      { key: "emergency_contact_2", label: "Second contact name", type: "text" },
      {
        key: "emergency_phone_2",
        label: "Second contact phone",
        type: "tel",
        placeholder: "(303) 555-0100",
        format: formatPhoneNumber,
      },
      { key: "emergency_contact_2_relationship", label: "Second contact relationship", type: "text" },
    ],
    summary: (profileFields) =>
      [
        profileFields.emergency_contact_relationship
          ? `${profileFields.emergency_contact} (${profileFields.emergency_contact_relationship})`
          : profileFields.emergency_contact,
        profileFields.emergency_phone,
        profileFields.emergency_contact_2 && `2nd: ${profileFields.emergency_contact_2}`,
      ]
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
        // Food only. The answer is shown on rosters and print sheets for
        // meal planning, so it mustn't invite medical information, which
        // is collected separately (health history).
        placeholder: "Vegetarian, gluten-free, food allergies, dislikes…",
        helpText: "Food only — medical and health information is collected separately.",
        required: true,
      },
    ],
    summary: (profileFields) => {
      const value = (profileFields.dietary_notes ?? "").trim();
      return value === DIETARY_NONE ? "No dietary restrictions" : truncate(value);
    },
  },
  {
    id: "fly_fishing_sizing",
    title: "Fly fishing experience & gear sizing",
    layout: "stack",
    fields: [
      {
        key: "fly_fishing_experience",
        label: "Fly fishing experience",
        type: "select",
        required: true,
        options: FLY_FISHING_EXPERIENCE.map((v) => ({ value: v, label: v })),
      },
      {
        key: "needs_boots",
        label: "Do you need to borrow boots?",
        type: "yesno_bool",
        required: true,
      },
      {
        key: "boot_size",
        label: "Boot size (US men's)",
        type: "select",
        required: true,
        options: BOOT_SIZES.map((v) => ({ value: v, label: v })),
        showWhen: { key: "needs_boots", equals: "true" },
      },
      {
        key: "needs_waders",
        label: "Do you need to borrow waders?",
        type: "yesno_bool",
        required: true,
      },
      {
        key: "wader_size",
        label: "Wader size",
        type: "select",
        required: true,
        options: WADER_SIZES.map((v) => ({ value: v, label: v })),
        showWhen: { key: "needs_waders", equals: "true" },
      },
      {
        key: "needs_rod_reel",
        label: "Do you need to borrow a rod and reel?",
        type: "yesno_bool",
        required: true,
      },
    ],
    summary: (p) => {
      const gear = (needs: string, label: string, size: string) =>
        needs === "true" ? `${label} ${size || "?"}` : null;
      return [
        p.fly_fishing_experience,
        gear(p.needs_boots, "boots", p.boot_size),
        gear(p.needs_waders, "waders", p.wader_size),
        p.needs_rod_reel === "true" ? "rod & reel" : null,
      ]
        .filter(Boolean)
        .join(" · ");
    },
  },
  {
    id: "waiver",
    title: "Liability waiver",
    // Required for every event, like the emergency contact: a valid
    // signature on the active waiver for the event's state and year.
    alwaysRequired: true,
    kind: "waiver",
    fields: [],
    summary: () => "",
  },
  {
    id: "directory",
    title: "Participant directory",
    alwaysEditable: true,
    profileOnly: true,
    fields: [
      {
        // Boolean column, held as "true"/"false" strings in form state like
        // every other field (see profileValueFromColumn / columnValueFromProfile).
        key: "directory_opt_in",
        label: "Include me in the FTGF participant directory",
        type: "checkbox",
        helpText:
          "This publishes your name, chapter, email, and phone in a directory that is intended to be public and searchable. You can change this any time from your profile.",
      },
    ],
    summary: (profileFields) =>
      profileFields.directory_opt_in === "true"
        ? "Included in the directory"
        : "Not included in the directory",
  },
];

/** Reads a profiles column into the string form used in form state. */
export function profileValueFromColumn(
  field: RegistrationField,
  raw: unknown,
): string {
  if (field.type === "checkbox") return raw === true ? "true" : "false";
  if (field.type === "yesno_bool") {
    return raw === true ? "true" : raw === false ? "false" : "";
  }
  const value = (raw as string | null | undefined) ?? "";
  return field.format ? field.format(value) : value;
}

/**
 * Converts form-state strings back to column values: checkbox → boolean,
 * yesno_bool → true / false / null (unanswered), select → text or null.
 */
export function columnValuesFromProfile(
  values: Record<string, string>,
): Record<string, string | boolean | null> {
  const fieldsByKey = new Map(
    REGISTRATION_SECTIONS.flatMap((s) => s.fields).map((f) => [f.key, f]),
  );
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => {
      const type = fieldsByKey.get(k)?.type;
      if (type === "checkbox") return [k, v === "true"];
      if (type === "yesno_bool") return [k, v === "true" ? true : v === "false" ? false : null];
      if (type === "select") return [k, v || null];
      return [k, v];
    }),
  );
}

/** Whether a field currently applies, given the section's other values. */
export function isFieldVisible(
  field: RegistrationField,
  values: Record<string, string>,
): boolean {
  return !field.showWhen || values[field.showWhen.key] === field.showWhen.equals;
}

/** The fields of a section that currently apply (conditional ones hidden). */
export function visibleFields(
  section: RegistrationSection,
  values: Record<string, string>,
): RegistrationField[] {
  return section.fields.filter((field) => isFieldVisible(field, values));
}

/** Blanks every hidden conditional field (e.g. boot size once "needs boots"
 * is No) so a stale answer is never saved. */
export function withHiddenFieldsCleared(
  values: Record<string, string>,
): Record<string, string> {
  const next = { ...values };
  for (const section of REGISTRATION_SECTIONS) {
    for (const field of section.fields) {
      if (!isFieldVisible(field, next)) next[field.key] = "";
    }
  }
  return next;
}

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
    (field) =>
      !field.required ||
      !isFieldVisible(field, profileFields) ||
      Boolean(profileFields[field.key]?.trim()),
  );
}

/**
 * What an RSVP row's dietary copy says, in three distinct states:
 *   null          → never answered (or the event doesn't collect it)
 *   DIETARY_NONE  → answered "No" — no restrictions
 *   any text      → the restrictions
 * The roster and print sheet show each differently (see dietaryDisplay).
 */
export type DietaryDisplay =
  | { kind: "not_answered" }
  | { kind: "none" }
  | { kind: "restrictions"; text: string };

export function dietaryDisplay(note: string | null | undefined): DietaryDisplay {
  const value = (note ?? "").trim();
  if (!value) return { kind: "not_answered" };
  if (value === DIETARY_NONE) return { kind: "none" };
  return { kind: "restrictions", text: value };
}

/**
 * The dietary answer copied onto an RSVP row for the roster and print sheet —
 * or null when the event doesn't collect dietary or nothing has been answered.
 * "No" is kept as the DIETARY_NONE sentinel (not dropped to null) so "answered
 * No" stays distinguishable from "never answered". Taken from what's being saved now (`updates`) or else what the
 * PROFILE has on file (`onFile`) — never from a form's own state, which can be
 * stale when the profile was changed elsewhere (the profile page, another
 * event) since the form was loaded. One rule for the RSVP form, "Update my
 * registration" and the walk-up action.
 */
export function dietaryNoteForRsvp(
  sections: RegistrationSection[],
  onFile: Record<string, string>,
  updates: Record<string, string>,
): string | null {
  if (!sections.some((section) => section.id === "dietary")) return null;
  const value = (updates.dietary_notes ?? onFile.dietary_notes ?? "").trim();
  return value || null;
}

/** The sections that apply to a given event: always-required ones plus
 * whichever optional ones are listed in that event's `registration_sections`. */
export function sectionsForEvent(
  registrationSections: string[] | null | undefined,
): RegistrationSection[] {
  const active = new Set(registrationSections ?? []);
  return REGISTRATION_SECTIONS.filter(
    (section) => !section.profileOnly && (section.alwaysRequired || active.has(section.id)),
  );
}

/** Sections an admin can turn on for an event: optional and event-level. */
export const EVENT_LEVEL_OPTIONAL_SECTIONS = REGISTRATION_SECTIONS.filter(
  (section) => !section.alwaysRequired && !section.profileOnly,
);

/**
 * The first section that still needs an answer: not complete under `values`
 * and missing a required, currently-visible field. The waiver is handled
 * separately (it isn't profile-backed). One rule shared by the RSVP form and
 * the admin walk-up form (client) and the walk-up action (server).
 */
export function firstIncompleteSection(
  sections: RegistrationSection[],
  values: Record<string, string>,
): RegistrationSection | undefined {
  return sections.find((section) => {
    if (section.kind === "waiver") return false;
    if (isSectionComplete(section, values)) return false;
    return visibleFields(section, values).some(
      (field) => field.required && !(values[field.key] ?? "").trim(),
    );
  });
}

/**
 * The profile values to save after collecting `sections`. Sections already
 * complete on file are left alone (unless alwaysEditable); a hidden
 * conditional field is saved empty so a stale answer doesn't linger. One
 * rule shared by the RSVP form and the walk-up action, so both save the same
 * way. `onFile` is the profile's current values (empty for a new profile).
 */
export function collectSectionUpdates(
  sections: RegistrationSection[],
  onFile: Record<string, string>,
  values: Record<string, string>,
  options: {
    /** Section ids to save even though they're already complete on file — a
     * participant who chose to change an existing answer. */
    include?: ReadonlySet<string>;
  } = {},
): Record<string, string> {
  const cleared = withHiddenFieldsCleared(values);
  const updates: Record<string, string> = {};
  for (const section of sections) {
    if (section.kind === "waiver") continue;
    if (
      !section.alwaysEditable &&
      !options.include?.has(section.id) &&
      isSectionComplete(section, onFile)
    ) {
      continue;
    }
    for (const field of section.fields) {
      const value = (cleared[field.key] ?? "").trim();
      if (value || !isFieldVisible(field, cleared)) updates[field.key] = value;
    }
  }
  return updates;
}

/** The sections whose answers a roster shows for one person (the event's own
 * sections — dietary, sizing, … — not the waiver, which has its own column,
 * or the emergency contact, shown with the contact details). */
export function rosterAnswerSections(
  registrationSections: string[] | null | undefined,
): RegistrationSection[] {
  return sectionsForEvent(registrationSections).filter(
    (section) => section.kind !== "waiver" && section.id !== "emergency_contact",
  );
}

/** One person's answer to a section for a roster: its "On file" summary, or
 * null when they haven't completed it. */
export function rosterSectionAnswer(
  section: RegistrationSection,
  profileFields: Record<string, string>,
): string | null {
  return isSectionComplete(section, profileFields) ? section.summary(profileFields) || "—" : null;
}
