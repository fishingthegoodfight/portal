import type { createClient } from "@/lib/supabase/server";
import { timezoneForChapter, type Chapter } from "@/lib/chapters";
import { currentYearInZone } from "@/lib/waivers";
import { formatEventDateRange } from "@/lib/format-date";
import { loadMyHealthHistoryList } from "@/lib/health-access";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Who needs a health form, and when — the person-facing side (prompts after
 * an RSVP, a shift signup or a retreat registration, the volunteer page).
 * The roster's view of the same rule is event_health_history_status in the
 * database. Neither reads any health content: only when someone's forms
 * were signed.
 *
 * One rule, decided by the event alone: anyone on an event with
 * requires_health_history on — an active RSVP, a retreat registration or a
 * confirmed volunteer shift, no difference — and nobody at an event without
 * it. A form covers any event that starts within 12 months after it was
 * signed (health_history_covering in the database; see the 2026-11-04
 * "Retreats, part 2" entry in schema-changes.sql).
 */

/** How long a form covers events for, from the day it's signed. */
export const HEALTH_FORM_MONTHS = 12;

/** The year stored on a form signed now (health_histories.year — kept for
 * the record, no longer what decides coverage): the current calendar year
 * in the person's home chapter's timezone. */
export function healthFormYearFor(profileChapter: string | null | undefined, chapters: Chapter[]): number {
  return currentYearInZone(timezoneForChapter(profileChapter, chapters));
}

/** The instant `months` months after `iso` (same day of the month). */
function addMonths(iso: string, months: number): Date {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** Until when a form signed at `signedAt` covers events: an event starting
 * before this. */
export function healthFormCoversUntil(signedAt: string): Date {
  return addMonths(signedAt, HEALTH_FORM_MONTHS);
}

/** Whether a form signed at `signedAt` covers an event: signed in the 12
 * months before it starts, and not after it ended. */
export function healthFormCovers(signedAt: string, event: { starts_at: string; ends_at: string | null }): boolean {
  const signed = new Date(signedAt).getTime();
  return (
    signed > addMonths(event.starts_at, -HEALTH_FORM_MONTHS).getTime() &&
    signed <= new Date(event.ends_at ?? event.starts_at).getTime()
  );
}

/** "Mar 4, 2027" in Mountain time (same deliberate default as the waivers). */
export function formatHealthDate(instant: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Denver",
  }).format(new Date(instant));
}

export type EventNeedingHealthForm = {
  eventId: number;
  name: string;
  dateRange: string;
  /** Null when a form signed today would cover it. Otherwise the event is
   * more than 12 months away and a form for it can only be signed from
   * this day ("Mar 4, 2027"). */
  opensOn: string | null;
};

type EventRow = {
  id: number;
  name: string;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  status: string;
  requires_health_history: boolean;
};

/**
 * The signed-in person's upcoming events that no form of theirs covers —
 * soonest first. `onlyEventId` narrows it to one event (the RSVP page).
 */
export async function eventsNeedingHealthForm(
  supabase: SupabaseServerClient,
  userId: string,
  onlyEventId?: number,
): Promise<EventNeedingHealthForm[]> {
  const eventColumns = "id, name, starts_at, ends_at, timezone, status, requires_health_history";

  const rsvpQuery = supabase
    .from("rsvps")
    .select(`event:events(${eventColumns})`)
    .eq("user_id", userId)
    .in("status", ["confirmed", "waitlisted", "offered"]);
  const retreatQuery = supabase
    .from("retreat_registrations")
    .select(`event:events(${eventColumns})`)
    .eq("user_id", userId)
    .in("status", ["pending_payment", "confirmed", "waitlisted", "offered"]);
  const shiftQuery = supabase
    .from("volunteer_signups")
    .select(`opportunity:volunteer_opportunities(event:events(${eventColumns}))`)
    .eq("user_id", userId)
    .eq("status", "confirmed");

  const [{ data: rsvps }, { data: registrations }, { data: shifts }, forms] = await Promise.all([
    rsvpQuery,
    retreatQuery,
    shiftQuery,
    loadMyHealthHistoryList(supabase),
  ]);

  // Every event they're on, as a participant or a volunteer — then the one
  // rule, applied the same way to both.
  const onEvents = [
    ...((rsvps ?? []) as unknown as { event: EventRow | null }[]).map((row) => row.event),
    ...((registrations ?? []) as unknown as { event: EventRow | null }[]).map((row) => row.event),
    ...((shifts ?? []) as unknown as { opportunity: { event: EventRow | null } | null }[]).map(
      (row) => row.opportunity?.event ?? null,
    ),
  ];
  const events = new Map<number, EventRow>();
  for (const event of onEvents) {
    if (!event || !event.requires_health_history) continue;
    if (onlyEventId != null && event.id !== onlyEventId) continue;
    events.set(event.id, event);
  }

  const now = new Date();
  return [...events.values()]
    .filter((e) => e.status !== "cancelled" && new Date(e.ends_at ?? e.starts_at).getTime() >= now.getTime())
    .filter((e) => !forms.some((f) => healthFormCovers(f.signedAt, e)))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((event) => {
      const opens = addMonths(event.starts_at, -HEALTH_FORM_MONTHS);
      return {
        eventId: event.id,
        name: event.name,
        dateRange: formatEventDateRange(event.starts_at, event.ends_at, event.timezone),
        opensOn: opens.getTime() >= now.getTime() ? formatHealthDate(opens) : null,
      };
    });
}
