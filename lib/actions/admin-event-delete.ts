"use server";

import { createClient } from "@/lib/supabase/server";
import { actorLabel, loadManagedEventIds, requireEventManager } from "@/lib/admin/require-admin";
import { eventsWithRegistrations } from "@/lib/admin/event-delete";
import { sendAdminChangeNotificationEmail } from "@/lib/email/send";

type OccurrenceRow = { id: number; name: string; starts_at: string; timezone: string; status: string };

const shortDate = (o: { starts_at: string; timezone: string }) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: o.timezone,
  }).format(new Date(o.starts_at));

export type LaterOccurrence = { id: number; date: string; cancelled: boolean };

export type DeleteScopeResult =
  | {
      ok: true;
      /** Later occurrences in the series with no registrations — what "this
       * and all future" also deletes. */
      deletable: LaterOccurrence[];
      /** Later occurrences that have registrations — left alone. */
      kept: LaterOccurrence[];
    }
  | { ok: false; error: string };

/** The later occurrences of this event's series (any status, only ones the
 * caller manages — the same set admin_delete_event considers). */
async function laterOccurrences(
  supabase: Awaited<ReturnType<typeof createClient>>,
  event: { series_id: string | null; starts_at: string },
): Promise<OccurrenceRow[]> {
  if (!event.series_id) return [];
  const [{ data }, managed] = await Promise.all([
    supabase
      .from("events")
      .select("id, name, starts_at, timezone, status")
      .eq("series_id", event.series_id)
      .gt("starts_at", event.starts_at)
      .order("starts_at", { ascending: true }),
    loadManagedEventIds(supabase),
  ]);
  return ((data ?? []) as OccurrenceRow[]).filter((o) => managed.has(o.id));
}

/** For a series occurrence's delete confirmation: which later occurrences
 * "this and all future" would also delete, and which it would keep. */
export async function deleteEventScopeAction(eventId: number): Promise<DeleteScopeResult> {
  const supabase = await createClient();
  const gate = await requireEventManager(supabase, eventId);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { data: event } = await supabase
    .from("events")
    .select("series_id, starts_at")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { ok: false, error: "Event not found" };

  const later = await laterOccurrences(supabase, event as { series_id: string | null; starts_at: string });
  const taken = await eventsWithRegistrations(supabase, later.map((o) => o.id));
  const toItem = (o: OccurrenceRow): LaterOccurrence => ({
    id: o.id,
    date: shortDate(o),
    cancelled: o.status === "cancelled",
  });
  return {
    ok: true,
    deletable: later.filter((o) => !taken.has(o.id)).map(toItem),
    kept: later.filter((o) => taken.has(o.id)).map(toItem),
  };
}

export type DeleteEventResult =
  | {
      ok: true;
      deletedCount: number;
      /** The series id while any occurrence of it is still left, else null. */
      remainingSeriesId: string | null;
    }
  | { ok: false; error: string };

/**
 * Deletes an event nobody has ever registered or volunteered for — and, with
 * `includeLater`, every later occurrence of its series that's equally
 * empty. admin_delete_event does the checks and the deletes in one
 * transaction (see the 2026-09-24 schema-changes.sql entry); `typedName`
 * must match the event's title, the same confirmation the UI asks for.
 */
export async function deleteEventAction(
  eventId: number,
  includeLater: boolean,
  typedName: string,
): Promise<DeleteEventResult> {
  const supabase = await createClient();
  const gate = await requireEventManager(supabase, eventId);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { data: event } = await supabase
    .from("events")
    .select("id, name, chapter, series_id, starts_at, timezone")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { ok: false, error: "Event not found" };
  if (typedName.trim() !== (event.name as string).trim()) {
    return { ok: false, error: "Type the event's name exactly to confirm" };
  }

  // Dates for the notification email, read before the rows are gone.
  const later = includeLater
    ? await laterOccurrences(supabase, event as { series_id: string | null; starts_at: string })
    : [];
  const dateById = new Map(
    [event as { id: number; starts_at: string; timezone: string }, ...later].map((o) => [
      o.id,
      shortDate(o),
    ]),
  );

  const { data: deleted, error } = await supabase.rpc("admin_delete_event", {
    p_event_id: eventId,
    p_include_later: includeLater,
  });
  if (error) return { ok: false, error: error.message };
  // setof bigint — accept both bare values and single-key rows.
  const deletedIds = ((deleted ?? []) as unknown[]).map((d) =>
    Number(d != null && typeof d === "object" ? Object.values(d)[0] : d),
  );
  const seriesId = (event.series_id as string | null) ?? null;

  // No audit table in this schema — the admin change notification is the
  // record of who deleted what and when, same as every other event change.
  try {
    await sendAdminChangeNotificationEmail({
      action: "deleted",
      actorLabel: actorLabel(gate.actor),
      eventName: event.name as string,
      eventId,
      chapter: (event.chapter as string | null) ?? null,
      adminPath: seriesId ? `/protected/admin/events/series/${seriesId}` : "/protected/admin",
      diff: [
        {
          label: deletedIds.length === 1 ? "Event" : `Occurrences (${deletedIds.length})`,
          before: deletedIds.map((id) => dateById.get(id) ?? `#${id}`).join(", "),
          after: "Deleted — nobody had registered or signed up",
        },
      ],
    });
  } catch (err) {
    console.error(`Failed to send admin change notification for event ${eventId} deletion:`, err);
  }

  let remainingSeriesId: string | null = null;
  if (seriesId) {
    const { count } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("series_id", seriesId);
    if ((count ?? 0) > 0) remainingSeriesId = seriesId;
  }
  return { ok: true, deletedCount: deletedIds.length, remainingSeriesId };
}
