import type { createClient } from "@/lib/supabase/server";
import type { HealthHistoryRecord } from "@/lib/health-history";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Who may see health history — the app's only way to ask, and the only way
 * to read it. The rule lives in the database (see the 2026-09-25
 * "Sensitive-data flags" and "Health history form" entries in
 * schema-changes.sql), never re-derived here:
 *
 *   profiles.can_view_health_history AND can_manage_event(event)
 *   AND the subject is on that event's roster.
 *
 * The flag never grants scope of its own: a retreat's lead with the flag sees
 * that retreat's roster only; an admin with it sees every event's, because
 * admin scope is everything.
 *
 * No API role can select from health_histories. Every read below is a
 * database function that checks access and writes health_access_log in the
 * same call, so a read can't happen without its log entry:
 *   - staff opening one form: "view", per person
 *   - the roster-wide print: "print", per person printed
 *   - a roster showing health-derived markers: one "roster_view" per load
 *   - someone opening their own form: "self_view" (kept apart from staff
 *     access — the log's job is who else looked)
 *
 * Health data must never reach an email, an export, the marketing page, or
 * any screen that doesn't go through one of these.
 */

export type HealthAccessAction = "view" | "print";

/** Whether the signed-in person may see health data for this event at all
 * (the flag, within their can_manage_event scope) — e.g. to show the
 * roster's health links. Not a read; not logged. */
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
 * context of this event. Not a read; not logged. */
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

/** Records a staff read or print in health_access_log. The read functions
 * below already log their own access — this is for anything that shows
 * health data some other way. False when the access isn't allowed or the
 * entry couldn't be written; either way the data must not be shown. */
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

export type HealthRead<T> = { ok: true; data: T } | { ok: false; error: string };

function failed<T>(error: { message: string } | null, what: string): HealthRead<T> {
  console.error(`[health access] ${what}: ${error?.message ?? "no data"}`);
  return { ok: false, error: error?.message ?? "Couldn't load health information" };
}

/** Staff: the form covering this event for one person, or null when there
 * isn't one. Logs "view". Refused unless can_view_health_history. */
export async function loadHealthHistoryForStaff(
  supabase: SupabaseServerClient,
  subjectUserId: string,
  eventId: number,
): Promise<HealthRead<HealthHistoryRecord | null>> {
  const { data, error } = await supabase.rpc("health_history_for_staff", {
    p_subject_user_id: subjectUserId,
    p_event_id: eventId,
  });
  if (error) return failed(error, `staff view of ${subjectUserId} for event ${eventId}`);
  return { ok: true, data: ((data ?? []) as HealthHistoryRecord[])[0] ?? null };
}

/** Staff: every covering form on the event's roster, for the print view.
 * Logs "print" per person returned. */
export async function loadHealthHistoriesForPrint(
  supabase: SupabaseServerClient,
  eventId: number,
): Promise<HealthRead<HealthHistoryRecord[]>> {
  const { data, error } = await supabase.rpc("health_histories_for_print", { p_event_id: eventId });
  if (error) return failed(error, `print for event ${eventId}`);
  return { ok: true, data: (data ?? []) as HealthHistoryRecord[] };
}

export type HealthMarker = { needsReview: boolean; changedAtCheckin: boolean };

/** Staff: the roster's health-derived markers, by user id — or null when the
 * viewer doesn't pass the health check (then nothing is shown, and nothing
 * is logged). Logs one "roster_view" per call. */
export async function loadHealthMarkers(
  supabase: SupabaseServerClient,
  eventId: number,
): Promise<Map<string, HealthMarker> | null> {
  if (!(await canViewEventHealthHistory(supabase, eventId))) return null;
  const { data, error } = await supabase.rpc("event_health_markers", { p_event_id: eventId });
  if (error) {
    console.error(`[health access] roster markers for event ${eventId}: ${error.message}`);
    return null;
  }
  return new Map(
    ((data ?? []) as { user_id: string; needs_review: boolean; changed_at_checkin: boolean }[]).map((row) => [
      row.user_id,
      { needsReview: row.needs_review, changedAtCheckin: row.changed_at_checkin },
    ]),
  );
}

export type HealthStatus = { required: boolean; hasCurrent: boolean; checkinAnswered: boolean };

/** Any event manager: per person on the roster, whether they need a form
 * for this event, whether one covers it, and whether the check-in question
 * was answered. No health content; not logged. */
export async function loadHealthStatus(
  supabase: SupabaseServerClient,
  eventId: number,
): Promise<Map<string, HealthStatus>> {
  const { data, error } = await supabase.rpc("event_health_history_status", { p_event_id: eventId });
  if (error) {
    console.error(`[health access] status for event ${eventId}: ${error.message}`);
    return new Map();
  }
  return new Map(
    (
      (data ?? []) as { user_id: string; required: boolean; has_current: boolean; checkin_answered: boolean }[]
    ).map((row) => [
      row.user_id,
      { required: row.required, hasCurrent: row.has_current, checkinAnswered: row.checkin_answered },
    ]),
  );
}

export type OwnHealthHistorySummary = { id: number; year: number; signedAt: string };

/** The signed-in person's own submissions — year and date only, newest
 * first. Not health content; not logged. */
export async function loadMyHealthHistoryList(
  supabase: SupabaseServerClient,
): Promise<OwnHealthHistorySummary[]> {
  const { data, error } = await supabase.rpc("my_health_history_list");
  if (error) {
    console.error(`[health access] own list: ${error.message}`);
    return [];
  }
  return ((data ?? []) as { id: number; year: number; signed_at: string }[]).map((row) => ({
    id: row.id,
    year: row.year,
    signedAt: row.signed_at,
  }));
}

/** One of the signed-in person's own submissions, or null if it isn't
 * theirs. Logs "self_view". */
export async function loadMyHealthHistory(
  supabase: SupabaseServerClient,
  id: number,
): Promise<HealthRead<HealthHistoryRecord | null>> {
  const { data, error } = await supabase.rpc("my_health_history", { p_id: id });
  if (error) return failed(error, `self view of ${id}`);
  return { ok: true, data: ((data ?? []) as HealthHistoryRecord[])[0] ?? null };
}
