import { createClient } from "@/lib/supabase/server";

export type AdminEventSummary = {
  id: number;
  name: string;
  chapter: string | null;
  event_type: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  location: string | null;
  description: string | null;
  capacity: number | null;
  spots_taken: number | null;
  lead_name: string | null;
  lead_phone: string | null;
  custom_email_note: string | null;
  status: string;
  cancellation_reason: string | null;
};

export type RosterPerson = {
  rsvpId: number;
  userId: string;
  status: string;
  checkedInAt: string | null;
  /** Per-RSVP dietary answer (rsvps.dietary_notes) — free text for
   * organizers, distinct from the profile's on-file default. */
  dietaryNotes: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  emergencyContact: string;
  emergencyPhone: string;
};

export type EventRoster = {
  event: AdminEventSummary;
  roster: RosterPerson[];
};

/**
 * Loads an event plus its non-cancelled roster (rsvps joined to profiles in
 * JS, not a PostgREST embed — rsvps.user_id and profiles.id both reference
 * auth.users independently, so there's no guaranteed direct FK between the
 * two tables for an embed to walk), sorted by last name.
 *
 * Shared by the admin roster page and the print view so the two can't drift.
 */
export async function loadEventRoster(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: number,
): Promise<EventRoster | null> {
  const { data: event } = await supabase
    .from("events")
    .select(
      "id, name, chapter, event_type, starts_at, ends_at, timezone, location, description, capacity, spots_taken, lead_name, lead_phone, custom_email_note, status, cancellation_reason",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (!event) return null;

  const { data: rsvpRows } = await supabase
    .from("rsvps")
    .select("id, user_id, status, checked_in_at, dietary_notes")
    .eq("event_id", eventId)
    .neq("status", "cancelled");

  const userIds = (rsvpRows ?? []).map((r) => r.user_id as string);

  const { data: profileRows } =
    userIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, first_name, last_name, email, phone, emergency_contact, emergency_phone")
          .in("id", userIds)
      : { data: [] as never[] };

  const profileById = new Map(
    (profileRows ?? []).map((p) => [p.id as string, p]),
  );

  const roster: RosterPerson[] = (rsvpRows ?? []).map((r) => {
    const profile = profileById.get(r.user_id as string);
    return {
      rsvpId: r.id as number,
      userId: r.user_id as string,
      status: r.status as string,
      checkedInAt: (r.checked_in_at as string | null) ?? null,
      dietaryNotes: (r.dietary_notes as string | null) ?? null,
      firstName: (profile?.first_name as string | null) ?? "",
      lastName: (profile?.last_name as string | null) ?? "",
      email: (profile?.email as string | null) ?? "",
      phone: (profile?.phone as string | null) ?? "",
      emergencyContact: (profile?.emergency_contact as string | null) ?? "",
      emergencyPhone: (profile?.emergency_phone as string | null) ?? "",
    };
  });

  roster.sort((a, b) =>
    (a.lastName || a.firstName).localeCompare(b.lastName || b.firstName, undefined, {
      sensitivity: "base",
    }),
  );

  return { event: event as AdminEventSummary, roster };
}
