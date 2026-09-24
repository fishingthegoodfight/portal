import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The app's one definition of an "empty" event — the only kind that can be
 * deleted, from its Manage page or the series page: nobody has EVER
 * registered or signed up, i.e. no rsvps row or volunteer_signups row in any
 * status, cancelled included. Returns the ids that are NOT empty.
 * The app-side mirror of event_has_registrations() in the database (the
 * 2026-09-24 schema-changes.sql entries), which admin_delete_event and
 * admin_delete_empty_events actually enforce; this only decides what to
 * offer. Read through RLS, so pass only events the caller manages.
 */
export async function eventsWithRegistrations(
  supabase: SupabaseServerClient,
  eventIds: number[],
): Promise<Set<number>> {
  const result = new Set<number>();
  if (eventIds.length === 0) return result;

  const [{ data: rsvps }, { data: opportunities }] = await Promise.all([
    supabase.from("rsvps").select("event_id").in("event_id", eventIds),
    supabase.from("volunteer_opportunities").select("id, event_id").in("event_id", eventIds),
  ]);
  for (const r of rsvps ?? []) result.add(r.event_id as number);

  const eventByOpportunity = new Map(
    (opportunities ?? []).map((o) => [o.id as number, o.event_id as number]),
  );
  if (eventByOpportunity.size > 0) {
    const { data: signups } = await supabase
      .from("volunteer_signups")
      .select("opportunity_id")
      .in("opportunity_id", [...eventByOpportunity.keys()]);
    for (const s of signups ?? []) {
      result.add(eventByOpportunity.get(s.opportunity_id as number) as number);
    }
  }
  return result;
}
