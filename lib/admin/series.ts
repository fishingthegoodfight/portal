import type { createClient } from "@/lib/supabase/server";

/**
 * Recurring series (events sharing a series_id — see createEventAction):
 * which occurrences an "all future events" edit or cancel reaches, and who's
 * on them. "Future" is relative to the occurrence being edited, not to now,
 * and only scheduled occurrences are included — a cancelled one is left as
 * it is (restoring it later is its own decision).
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type EditScope = "this" | "future";

/** Scheduled occurrences in the series that start after `startsAt`, soonest first. */
export async function laterOccurrenceIds(
  supabase: SupabaseServerClient,
  seriesId: string,
  startsAt: string,
): Promise<number[]> {
  const { data } = await supabase
    .from("events")
    .select("id")
    .eq("series_id", seriesId)
    .eq("status", "scheduled")
    .gt("starts_at", startsAt)
    .order("starts_at", { ascending: true });
  return (data ?? []).map((e) => e.id as number);
}

export type OccurrencePeople = {
  /** Confirmed RSVPs. */
  confirmed: number;
  /** Waitlisted or holding an open offer. */
  waiting: number;
  /** Confirmed volunteer signups on active (not cancelled) roles. */
  volunteers: number;
};

export const EMPTY_PEOPLE: OccurrencePeople = { confirmed: 0, waiting: 0, volunteers: 0 };

/** Who is currently on each of these events — for display (the series
 * page's counts, the scope question). NOT the rule for whether an event can
 * be deleted: that's eventsWithRegistrations (lib/admin/event-delete.ts),
 * which also counts cancelled registrations. */
export async function peopleByEvent(
  supabase: SupabaseServerClient,
  eventIds: number[],
): Promise<Map<number, OccurrencePeople>> {
  const result = new Map<number, OccurrencePeople>(eventIds.map((id) => [id, { ...EMPTY_PEOPLE }]));
  if (eventIds.length === 0) return result;

  const [{ data: rsvps }, { data: opportunities }] = await Promise.all([
    supabase
      .from("rsvps")
      .select("event_id, status")
      .in("event_id", eventIds)
      .in("status", ["confirmed", "waitlisted", "offered"]),
    supabase.from("volunteer_opportunities").select("id, event_id").in("event_id", eventIds),
  ]);
  for (const r of rsvps ?? []) {
    const people = result.get(r.event_id as number);
    if (!people) continue;
    if (r.status === "confirmed") people.confirmed++;
    else people.waiting++;
  }

  const eventByOpportunity = new Map((opportunities ?? []).map((o) => [o.id as number, o.event_id as number]));
  if (eventByOpportunity.size > 0) {
    const { data: signups } = await supabase
      .from("volunteer_signups")
      .select("opportunity_id")
      .in("opportunity_id", [...eventByOpportunity.keys()])
      .eq("status", "confirmed");
    for (const s of signups ?? []) {
      const people = result.get(eventByOpportunity.get(s.opportunity_id as number) as number);
      if (people) people.volunteers++;
    }
  }
  return result;
}

export function sumPeople(people: Iterable<OccurrencePeople>): OccurrencePeople {
  const total = { ...EMPTY_PEOPLE };
  for (const p of people) {
    total.confirmed += p.confirmed;
    total.waiting += p.waiting;
    total.volunteers += p.volunteers;
  }
  return total;
}
