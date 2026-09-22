/**
 * Event templates (tables `event_templates` / `event_template_roles`, see
 * the 2026-09-22 "event templates" schema-changes.sql entry) — a reusable
 * starting point for the admin create wizard. Applying one only ever copies
 * values onto a new event at creation time; there is no link stored back
 * from an event to the template that seeded it, so editing or deactivating
 * a template can never change an event already created from it.
 */

export type ShiftAnchor = "event_start" | "event_end";

export type EventTemplateRole = {
  id: number;
  role_type_id: number;
  /** Overrides/extends volunteer_role_types.description for this program —
   * e.g. what to bring is standard per program, not per role type. */
  description: string | null;
  what_to_bring: string | null;
  /** Each boundary anchors independently — e.g. a setup role starts before
   * event_start and a cleanup role ends after event_end, so neither drifts
   * when the event's own length changes. Offsets are signed minutes from
   * their own anchor (negative = before, positive = after). */
  shift_start_anchor: ShiftAnchor;
  shift_start_offset: number;
  shift_end_anchor: ShiftAnchor;
  shift_end_offset: number;
  number_needed: number;
  sort_order: number;
};

export type EventTemplate = {
  id: number;
  name: string;
  event_type: string;
  /** Null = available to every chapter's create wizard. */
  chapter: string | null;
  description: string | null;
  default_capacity: number | null;
  default_registration_sections: string[];
  default_virtual_link: string | null;
  default_virtual_access_notes: string | null;
  active: boolean;
};

export type EventTemplateWithRoles = EventTemplate & { roles: EventTemplateRole[] };
