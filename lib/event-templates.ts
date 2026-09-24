import type { LocationFieldsValue } from "@/lib/event-location";

/**
 * Event templates (tables `event_templates` / `event_template_roles`, see
 * the 2026-09-22 "event templates" schema-changes.sql entry) — a reusable
 * starting point for the admin create wizard. Applying one only ever copies
 * values onto a new event at creation time. The event records which
 * template seeded it (events.created_from_template_id) as provenance only —
 * it's what stops a used template being deleted — so editing or
 * deactivating a template can never change an event already created from it.
 */

export type ShiftAnchor = "event_start" | "event_end";

export type EventTemplateRole = {
  id: number;
  role_type_id: number;
  /** Display-only label for this template's role, e.g. "Vise wrangler";
   * null = use the role type's name. The role type alone decides who's
   * eligible to sign up. */
  title: string | null;
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
  /** The template's own name in the picker, e.g. "Standard Fish A-Long" —
   * never copied onto an event. */
  name: string;
  /** Pre-fills the new event's title; null = the title starts blank. */
  default_title: string | null;
  event_type: string;
  /** Null = available to every chapter's create wizard. */
  chapter: string | null;
  description: string | null;
  default_capacity: number | null;
  default_registration_sections: string[];
  default_virtual_link: string | null;
  default_virtual_access_notes: string | null;
  /** A default physical location, copied onto the event like everything
   * else here (never a live link to a saved venue). */
  default_venue_name: string | null;
  default_street_address: string | null;
  default_city: string | null;
  default_state: string | null;
  default_postal_code: string | null;
  active: boolean;
};

export type EventTemplateWithRoles = EventTemplate & { roles: EventTemplateRole[] };

/** The select() column list for loading templates with their roles — shared
 * by the template admin screen and the create wizard's loader so neither can
 * miss a column. */
export const TEMPLATE_WITH_ROLES_COLUMNS =
  "id, name, default_title, event_type, chapter, description, default_capacity, default_registration_sections, default_virtual_link, default_virtual_access_notes, default_venue_name, default_street_address, default_city, default_state, default_postal_code, active, roles:event_template_roles(id, role_type_id, title, description, what_to_bring, shift_start_anchor, shift_start_offset, shift_end_anchor, shift_end_offset, number_needed, sort_order)";

/** A template's default location as form fields (all blank for none). */
export function templateLocation(template: EventTemplate): LocationFieldsValue {
  return {
    venueName: template.default_venue_name ?? "",
    streetAddress: template.default_street_address ?? "",
    city: template.default_city ?? "",
    state: template.default_state ?? "",
    postalCode: template.default_postal_code ?? "",
  };
}
