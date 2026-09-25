import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Who may see health history — the app's only way to ask. The rule lives in
 * the database (see the 2026-09-25 "Sensitive-data flags" entry in
 * schema-changes.sql), never re-derived here:
 *
 *   profiles.can_view_health_history AND can_manage_event(event)
 *   AND the subject is on that event's roster.
 *
 * The flag never grants scope of its own: a retreat's lead with the flag sees
 * that retreat's roster only; an admin with it sees every event's, because
 * admin scope is everything.
 *
 * Nothing reads health data yet. When something does, it must call
 * canViewHealthHistory before showing anything and logHealthAccess for every
 * view or print — logHealthAccess re-checks the same rule and refuses
 * (returns false) if it doesn't hold, so a page can gate on its result.
 */

export type HealthAccessAction = "view" | "print";

/** Whether the signed-in person may see health data for this event at all
 * (the flag, within their can_manage_event scope) — e.g. to show a "Health
 * histories" link on an event's roster. */
export async function canViewEventHealthHistory(
  supabase: SupabaseServerClient,
  eventId: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("can_view_event_health_history", {
    p_event_id: eventId,
  });
  return !error && data === true;
}

/** Whether the signed-in person may see this person's health data, in the
 * context of this event. */
export async function canViewHealthHistory(
  supabase: SupabaseServerClient,
  subjectUserId: string,
  eventId: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("can_view_health_history", {
    p_subject_user_id: subjectUserId,
    p_event_id: eventId,
  });
  return !error && data === true;
}

/** Records a read or print in health_access_log (append-only). False when
 * the access isn't allowed or the entry couldn't be written — in either case
 * the health data must not be shown. */
export async function logHealthAccess(
  supabase: SupabaseServerClient,
  subjectUserId: string,
  eventId: number,
  action: HealthAccessAction,
): Promise<boolean> {
  const { error } = await supabase.rpc("log_health_access", {
    p_subject_user_id: subjectUserId,
    p_event_id: eventId,
    p_action: action,
  });
  if (error) {
    console.error(`[health access] ${action} of ${subjectUserId} for event ${eventId}: ${error.message}`);
    return false;
  }
  return true;
}
