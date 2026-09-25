import type { createClient } from "@/lib/supabase/server";
import { timezoneForChapter } from "@/lib/chapters";
import { currentYearInZone, eventYear } from "@/lib/waivers";
import { formatEventDateRange } from "@/lib/format-date";
import { loadMyHealthHistoryList } from "@/lib/health-access";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Who needs a health form, and for which year — the person-facing side
 * (prompts after an RSVP or a shift signup, the volunteer page). The
 * roster's view of the same rule is event_health_history_status in the
 * database. Neither reads any health content: only which years someone has
 * a form on file for.
 *
 * One rule, decided by the event alone: anyone on an event with
 * requires_health_history on — an active RSVP or a confirmed volunteer
 * shift, no difference — and nobody at an event without it. A form covers
 * the calendar year it was signed in, and has to match the event's year
 * (like waivers).
 */

/** The year a form signed now counts for: the current calendar year in the
 * person's home chapter's timezone (same default as the volunteer waiver). */
export function healthFormYearFor(profileChapter: string | null | undefined): number {
  return currentYearInZone(timezoneForChapter(profileChapter));
}

/** The years the signed-in person has a form on file for. */
export async function myHealthFormYears(supabase: SupabaseServerClient): Promise<Set<number>> {
  return new Set((await loadMyHealthHistoryList(supabase)).map((h) => h.year));
}

export type EventNeedingHealthForm = {
  eventId: number;
  name: string;
  dateRange: string;
  year: number;
  /** The form for `year` can't be signed yet (a January event, asked about
   * in December) — it opens on January 1. */
  opensLater: boolean;
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
 * The signed-in person's upcoming events that need a health form they don't
 * have for that event's year — soonest first. `onlyEventId` narrows it to
 * one event (the RSVP page).
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
  const shiftQuery = supabase
    .from("volunteer_signups")
    .select(`opportunity:volunteer_opportunities(event:events(${eventColumns}))`)
    .eq("user_id", userId)
    .eq("status", "confirmed");

  const [{ data: rsvps }, { data: shifts }, years, { data: profile }] = await Promise.all([
    rsvpQuery,
    shiftQuery,
    myHealthFormYears(supabase),
    supabase.from("profiles").select("chapter").eq("id", userId).maybeSingle(),
  ]);
  const signingYear = healthFormYearFor(profile?.chapter as string | null | undefined);

  // Every event they're on, as a participant or a volunteer — then the one
  // rule, applied the same way to both.
  const onEvents = [
    ...((rsvps ?? []) as unknown as { event: EventRow | null }[]).map((row) => row.event),
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

  const now = Date.now();
  return [...events.values()]
    .filter((e) => e.status !== "cancelled" && new Date(e.ends_at ?? e.starts_at).getTime() >= now)
    .map((e) => ({ event: e, year: eventYear(e.starts_at, e.timezone) }))
    .filter(({ year }) => !years.has(year))
    .sort((a, b) => a.event.starts_at.localeCompare(b.event.starts_at))
    .map(({ event, year }) => ({
      eventId: event.id,
      name: event.name,
      dateRange: formatEventDateRange(event.starts_at, event.ends_at, event.timezone),
      year,
      opensLater: year > signingYear,
    }));
}
