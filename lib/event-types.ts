/**
 * Event types (table `event_types`, see the 2026-09-22 "Event types as
 * data" schema-changes.sql entry) replace what used to be a hardcoded
 * EVENT_TYPES list here. events.event_type stays plain text — same reasoning
 * as events.chapter against the hardcoded CHAPTERS list — so a type that's
 * later renamed or deactivated never breaks an event that already used it.
 */

export type EventTypeOption = {
  id: number;
  key: string;
  name: string;
  /** Registration section ids (lib/registration-sections.ts) the create
   * wizard prefills when this type is chosen — still fully editable. */
  default_registration_sections: string[];
  sort_order: number;
  active: boolean;
};
