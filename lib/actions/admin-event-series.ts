"use server";

import { createClient } from "@/lib/supabase/server";
import { actorLabel, requireAdmin } from "@/lib/admin/require-admin";
import { sendAdminChangeNotificationEmail } from "@/lib/email/send";
import {
  isEmptyOccurrence,
  laterOccurrenceIds,
  peopleByEvent,
  sumPeople,
  type OccurrencePeople,
} from "@/lib/admin/series";

export type ScopeSummary = {
  /** This occurrence alone. */
  thisOnly: { eventCount: number; people: OccurrencePeople };
  /** This occurrence plus every later scheduled one. */
  future: { eventCount: number; people: OccurrencePeople; lastDate: string | null };
};

export type ScopeSummaryResult = ({ ok: true } & ScopeSummary) | { ok: false; error: string };

/** How many occurrences and people each scope choice reaches — shown on the
 * edit form's and the cancel dialog's "This event only / This and all future
 * events" step before the admin confirms. */
export async function seriesScopeSummaryAction(eventId: number): Promise<ScopeSummaryResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { data: event } = await supabase
    .from("events")
    .select("id, series_id, starts_at, status")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { ok: false, error: "Event not found" };
  if (!event.series_id) return { ok: false, error: "This event isn't part of a series" };

  const laterIds = await laterOccurrenceIds(supabase, event.series_id as string, event.starts_at as string);
  const people = await peopleByEvent(supabase, [eventId, ...laterIds]);
  const thisPeople = people.get(eventId) as OccurrencePeople;

  let lastDate: string | null = null;
  if (laterIds.length > 0) {
    const { data: last } = await supabase
      .from("events")
      .select("starts_at, timezone")
      .eq("id", laterIds[laterIds.length - 1])
      .maybeSingle();
    if (last) {
      lastDate = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: last.timezone as string,
      }).format(new Date(last.starts_at as string));
    }
  }

  return {
    ok: true,
    thisOnly: { eventCount: 1, people: thisPeople },
    future: {
      eventCount: 1 + laterIds.length,
      people: sumPeople(people.values()),
      lastDate,
    },
  };
}

export type DeleteOccurrencesResult =
  | { ok: true; deletedCount: number; skippedCount: number }
  | { ok: false; error: string };

/**
 * Deletes occurrences of a series nobody is on — no active RSVP and no
 * confirmed volunteer signup (admin_delete_empty_events re-checks that
 * under a row lock and skips any that aren't empty, reported back as
 * skippedCount). Anything with people goes through Cancel instead.
 *
 * `which` is either specific occurrence ids, or "future_empty": every
 * occurrence in the series that hasn't started yet and is empty — for
 * trimming a series that was generated too far out.
 */
export async function deleteSeriesOccurrencesAction(
  seriesId: string,
  which: number[] | "future_empty",
): Promise<DeleteOccurrencesResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { data: rows } = await supabase
    .from("events")
    .select("id, name, starts_at, timezone")
    .eq("series_id", seriesId)
    .order("starts_at", { ascending: true });
  const occurrences = (rows ?? []) as { id: number; name: string; starts_at: string; timezone: string }[];
  if (occurrences.length === 0) return { ok: false, error: "Series not found" };

  let candidates: typeof occurrences;
  if (which === "future_empty") {
    const now = Date.now();
    const upcoming = occurrences.filter((o) => new Date(o.starts_at).getTime() > now);
    const people = await peopleByEvent(
      supabase,
      upcoming.map((o) => o.id),
    );
    candidates = upcoming.filter((o) => isEmptyOccurrence(people.get(o.id) as OccurrencePeople));
  } else {
    const wanted = new Set(which);
    candidates = occurrences.filter((o) => wanted.has(o.id));
  }
  if (candidates.length === 0) return { ok: true, deletedCount: 0, skippedCount: 0 };

  const { data: deleted, error } = await supabase.rpc("admin_delete_empty_events", {
    p_event_ids: candidates.map((o) => o.id),
  });
  if (error) return { ok: false, error: error.message };
  // setof bigint — accept both bare values and single-key rows.
  const deletedIds = new Set(
    ((deleted ?? []) as unknown[]).map((d) =>
      Number(d != null && typeof d === "object" ? Object.values(d)[0] : d),
    ),
  );
  const deletedRows = candidates.filter((o) => deletedIds.has(o.id));

  if (deletedRows.length > 0) {
    try {
      const format = (o: (typeof occurrences)[number]) =>
        new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: o.timezone,
        }).format(new Date(o.starts_at));
      await sendAdminChangeNotificationEmail({
        action: "deleted",
        actorLabel: actorLabel(adminCheck.actor),
        eventName: deletedRows[0].name,
        eventId: deletedRows[0].id,
        adminPath: `/protected/admin/events/series/${seriesId}`,
        diff: [
          {
            label: deletedRows.length === 1 ? "Occurrence" : `Occurrences (${deletedRows.length})`,
            before: deletedRows.map(format).join(", "),
            after: "Deleted — nobody was registered",
          },
        ],
      });
    } catch (err) {
      console.error(`Failed to send admin change notification for series ${seriesId} deletion:`, err);
    }
  }

  return {
    ok: true,
    deletedCount: deletedRows.length,
    skippedCount: candidates.length - deletedRows.length,
  };
}
