export const EVENT_TYPES = [
  "Community Engagement",
  "Fly Tying",
  "Fish A-Long",
  "Fly Fishing Education",
  "Men's Night",
  "Social Event",
  "Other",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

// Which optional registration sections (ids from lib/registration-sections.ts)
// the "New event" form prefills for a given event type — still fully
// editable on the form itself, this is only a starting point.
const DEFAULT_REGISTRATION_SECTIONS_BY_EVENT_TYPE: Partial<Record<EventType, string[]>> = {
  "Fish A-Long": ["sizing", "waiver"],
  "Social Event": ["dietary"],
};

export function defaultRegistrationSectionsFor(eventType: string): string[] {
  return DEFAULT_REGISTRATION_SECTIONS_BY_EVENT_TYPE[eventType as EventType] ?? [];
}
