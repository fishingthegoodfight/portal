/**
 * Turns a database error from saving an event (or its volunteer roles) into
 * something an admin can act on: a plain-language message, plus which
 * create-wizard step and which field it belongs to, so the wizard can jump
 * back to that step and the edit form can point at the field. The raw
 * Postgres text is only ever logged on the server, never shown.
 *
 * The forms validate every constraint they know about before submitting
 * (lib/event-location.ts, lib/event-capacity.ts, lib/event-slug.ts,
 * volunteerRoleErrors) — this is the backstop for anything that still
 * reaches the database: a constraint added in the dashboard, a race (slug
 * taken, template deleted meanwhile), or a trigger's own refusal.
 */

/** 1 Basics · 2 Details · 3 Volunteers · 4 Recurrence & marketing — as in the wizard. */
export type EventFormStep = 1 | 2 | 3 | 4;

/** The field an error points at; also the suffix of its input's id on
 * both forms (`create_<field>` / `edit_<field>`) where one exists. */
export type EventFormField =
  | "template"
  | "chapter"
  | "event_type"
  | "title"
  | "date"
  | "time"
  | "timezone"
  | "slug"
  | "venue"
  | "street"
  | "city"
  | "state"
  | "postal_code"
  | "virtual_link"
  | "description"
  | "occurrence_note"
  | "capacity"
  | "lead"
  | "custom_note"
  | "sections"
  | "roles"
  | "recurrence"
  | "boost";

export type EventFormProblem = {
  message: string;
  step?: EventFormStep;
  field?: EventFormField;
};

type FieldInfo = { label: string; step: EventFormStep; field: EventFormField };

/** Database column -> the form field that sets it. */
const COLUMNS: Record<string, FieldInfo> = {
  name: { label: "Event title", step: 1, field: "title" },
  chapter: { label: "Chapter", step: 1, field: "chapter" },
  waiver_state: { label: "Chapter", step: 1, field: "chapter" },
  event_type: { label: "Event type", step: 1, field: "event_type" },
  created_from_template_id: { label: "Template", step: 1, field: "template" },
  starts_at: { label: "Date and start time", step: 1, field: "date" },
  ends_at: { label: "End time", step: 1, field: "time" },
  timezone: { label: "Time zone", step: 1, field: "timezone" },
  slug: { label: "Public link", step: 1, field: "slug" },
  venue_name: { label: "Venue name", step: 2, field: "venue" },
  location: { label: "Location", step: 2, field: "venue" },
  street_address: { label: "Street address", step: 2, field: "street" },
  city: { label: "City", step: 2, field: "city" },
  state: { label: "State", step: 2, field: "state" },
  postal_code: { label: "ZIP code", step: 2, field: "postal_code" },
  virtual_link: { label: "Meeting link", step: 2, field: "virtual_link" },
  virtual_access_notes: { label: "Access notes", step: 2, field: "virtual_link" },
  description: { label: "About this event", step: 2, field: "description" },
  occurrence_note: { label: "What's different about this one", step: 2, field: "occurrence_note" },
  capacity: { label: "Capacity", step: 2, field: "capacity" },
  spots_taken: { label: "Capacity", step: 2, field: "capacity" },
  lead_name: { label: "Lead name", step: 2, field: "lead" },
  lead_email: { label: "Lead email", step: 2, field: "lead" },
  lead_phone: { label: "Lead phone", step: 2, field: "lead" },
  lead_user_id: { label: "Lead account", step: 2, field: "lead" },
  custom_email_note: { label: "Email-only note", step: 2, field: "custom_note" },
  registration_sections: { label: "Registration sections", step: 2, field: "sections" },
  series_id: { label: "Repeats", step: 4, field: "recurrence" },
  recurrence_frequency: { label: "Repeats", step: 4, field: "recurrence" },
  recurrence_end_date: { label: "Repeat until", step: 4, field: "recurrence" },
  marketing_tier: { label: "Tier 1 marketing boost", step: 4, field: "boost" },
  // volunteer_opportunities
  role: { label: "Volunteer role title", step: 3, field: "roles" },
  slots: { label: "Volunteer role number needed", step: 3, field: "roles" },
  shift_start: { label: "Volunteer shift start", step: 3, field: "roles" },
  shift_end: { label: "Volunteer shift end", step: 3, field: "roles" },
  what_to_bring: { label: "Volunteer role what to bring", step: 3, field: "roles" },
  role_type_id: { label: "Volunteer role type", step: 3, field: "roles" },
};

/** Plain-language wording for a check constraint on a known column. */
const CHECK_MESSAGES: Partial<Record<string, string>> = {
  capacity: "Capacity must be a whole number of at least 1, or blank for unlimited",
  slots: "Every volunteer role needs a number needed of at least 1",
  slug: "The public link can only use lowercase letters, numbers and dashes, and must include a letter",
};

type DbError = { code?: string | null; message?: string | null; details?: string | null };

const GENERIC =
  "The event couldn't be saved because of an unexpected problem. Everything you entered is still here — try again, and if it keeps happening, let an admin know.";

/** The known column a constraint or message names, if any. Constraint names
 * follow Postgres's "<table>_<column>_<kind>" default (events_capacity_check,
 * events_slug_key), so the longest column name contained in it wins. */
function columnIn(text: string): string | null {
  const quoted = /column "([^"]+)"/.exec(text)?.[1];
  if (quoted && COLUMNS[quoted]) return quoted;
  const constraint = /constraint "([^"]+)"/.exec(text)?.[1] ?? "";
  const matches = Object.keys(COLUMNS).filter((c) => constraint.includes(c));
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}

function at(column: string | null, message: string): EventFormProblem {
  const info = column ? COLUMNS[column] : undefined;
  return info ? { message, step: info.step, field: info.field } : { message };
}

/**
 * `context` names the save in the server log. Our own trigger/function
 * refusals (raise exception — SQLSTATE P0001, or 42501/23503 with a message
 * we wrote) are already written for people and pass through as-is.
 */
export function friendlyEventDbError(error: DbError, context: string): EventFormProblem {
  const code = error.code ?? "";
  const text = [error.message, error.details].filter(Boolean).join(" ");
  console.error(`[event save] ${context}: ${code} ${text}`);

  // events_marketing_guard's refusals name no column; they're the boost's.
  const column = /Tier 1 event|marketing boost/.test(text) ? "marketing_tier" : columnIn(text);
  const label = column ? COLUMNS[column].label : null;

  switch (code) {
    case "23502": // not_null_violation
      return at(column, label ? `${label} is required` : "A required field is missing");
    case "23514": // check_violation
      return at(
        column,
        (column && CHECK_MESSAGES[column]) ?? (label ? `${label} isn't valid` : "One of the values isn't valid"),
      );
    case "23505": // unique_violation
      // events_tier1_per_chapter_month: someone else boosted the same
      // chapter's month between the check and this save (the trigger's own
      // refusal, which names the event, normally comes first).
      if (/tier1_per_chapter_month/.test(text)) {
        return at(
          "marketing_tier",
          "Another event in this chapter was just boosted to Tier 1 for the same month — reload to see which, or save without the boost",
        );
      }
      if (column === "slug") return at(column, "That public link is already used by another event");
      return at(column, label ? `${label} is already in use` : "This would duplicate something that already exists");
    case "23503": // foreign_key_violation
      if (column === "created_from_template_id") {
        return at(column, "The template you started from was just deleted — choose it again, or start blank");
      }
      if (column === "role_type_id") {
        return at(column, "A volunteer role type was just removed — choose the role type again");
      }
      if (column === "lead_user_id") return at(column, "Choose the lead again — that account no longer exists");
      break;
    case "22001": // string_data_right_truncation
      return at(column, label ? `${label} is too long` : "One of the fields is too long");
    case "22007": // invalid_datetime_format
    case "22008": // datetime_field_overflow
      return { message: "The date or time isn't valid", step: 1, field: "date" };
    case "22P02": // invalid_text_representation
    case "22003": // numeric_value_out_of_range
      return at(column, label ? `${label} isn't valid` : "One of the numbers isn't valid");
    case "42501": // insufficient_privilege — RLS or our own guards
      if (/row-level security/i.test(text)) {
        return { message: "You don't have permission to save events in this chapter", step: 1, field: "chapter" };
      }
      return at(column ?? "chapter", error.message ?? GENERIC);
    case "P0001": // raise exception in our own functions/triggers
      return at(column, error.message ?? GENERIC);
  }
  return { message: GENERIC };
}
