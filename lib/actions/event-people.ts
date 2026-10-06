"use server";

import { createClient } from "@/lib/supabase/server";
import { requireEventManager } from "@/lib/admin/require-admin";

export type EventPersonCandidate = {
  id: string;
  name: string;
  email: string;
  chapter: string;
  /** Their RSVP to this event, if any ('confirmed', 'waitlisted', …). */
  rsvpStatus: string | null;
};

export type EventPeopleResult = { ok: true; people: EventPersonCandidate[] } | { ok: false; error: string };

/**
 * The roster's "find someone already in the system" search
 * (event_person_candidates): by name or email, for whoever manages the
 * event. Admins find anyone; anyone else finds people of the event's
 * chapter, the chapters they lead, and people who've been to that chapter's
 * events. At most 10, and only for 2+ characters.
 */
export async function searchEventPeopleAction(eventId: number, query: string): Promise<EventPeopleResult> {
  const supabase = await createClient();
  const gate = await requireEventManager(supabase, eventId);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { data, error } = await supabase.rpc("event_person_candidates", { p_event_id: eventId, p_query: query });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    people: (
      (data ?? []) as {
        id: string;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        chapter: string | null;
        rsvp_status: string | null;
      }[]
    ).map((p) => ({
      id: p.id,
      name: [p.first_name, p.last_name].filter(Boolean).join(" "),
      email: p.email ?? "",
      chapter: p.chapter ?? "",
      rsvpStatus: p.rsvp_status,
    })),
  };
}
