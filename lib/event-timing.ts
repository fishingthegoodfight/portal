import { formatDateInZone } from "@/lib/format-date";

/** When an event ran — what "after the event" is measured against. */
export type EventTiming = { startsAt: string; endsAt: string | null; timeZone: string };

/**
 * Whether the instant `at` (ISO) is after the event: past its end, or, for
 * an event with no end time, on a later day (its time zone) than it
 * started. The same line as event_has_ended in the database, which decides
 * when a walk-up can no longer sign in the portal. Plain function, safe in
 * client components.
 */
export function isAfterEvent(at: string, timing: EventTiming): boolean {
  const instant = new Date(at).getTime();
  const start = new Date(timing.startsAt).getTime();
  const end = timing.endsAt ? new Date(timing.endsAt).getTime() : start;
  return end > start
    ? instant > end
    : instant > start && formatDateInZone(at, timing.timeZone) !== formatDateInZone(timing.startsAt, timing.timeZone);
}
