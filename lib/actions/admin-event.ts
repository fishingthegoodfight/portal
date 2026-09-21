"use server";

import { createClient } from "@/lib/supabase/server";
import { actorLabel, requireAdmin } from "@/lib/admin/require-admin";
import { formatEventDateRange } from "@/lib/format-date";
import { zonedDateTimeToUtc } from "@/lib/timezone";
import { REGISTRATION_SECTIONS } from "@/lib/registration-sections";
import {
  previewEventCancellationEmail,
  sendAdminChangeNotificationEmail,
  sendEventCancellationEmail,
  sendEventRestoredEmail,
  sendEventUpdateEmail,
  type RsvpEmailEvent,
} from "@/lib/email/send";
import type { EventChangeDiffEntry } from "@/lib/email/templates";
import { offerFreeSpots } from "@/lib/waitlist";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type EventRow = {
  id: number;
  name: string;
  description: string | null;
  location: string | null;
  capacity: number | null;
  lead_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  custom_email_note: string | null;
  registration_sections: string[] | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  ics_sequence: number;
  status: string;
  cancellation_reason: string | null;
};

const EVENT_COLUMNS =
  "id, name, description, location, capacity, lead_name, lead_phone, lead_email, custom_email_note, registration_sections, starts_at, ends_at, timezone, ics_sequence, status, cancellation_reason";

async function loadEvent(
  supabase: SupabaseServerClient,
  eventId: number,
): Promise<EventRow | null> {
  const { data } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("id", eventId)
    .maybeSingle();
  return (data as EventRow | null) ?? null;
}

async function confirmedRsvpEmails(
  supabase: SupabaseServerClient,
  eventId: number,
): Promise<string[]> {
  const { data: rsvps } = await supabase
    .from("rsvps")
    .select("user_id")
    .eq("event_id", eventId)
    .eq("status", "confirmed");
  const userIds = (rsvps ?? []).map((r) => r.user_id as string);
  if (userIds.length === 0) return [];

  const { data: profiles } = await supabase.from("profiles").select("email").in("id", userIds);
  return (profiles ?? [])
    .map((p) => p.email as string | null)
    .filter((email): email is string => Boolean(email));
}

async function countConfirmedRsvps(
  supabase: SupabaseServerClient,
  eventId: number,
): Promise<number> {
  const { count } = await supabase
    .from("rsvps")
    .select("*", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("status", "confirmed");
  return count ?? 0;
}

function toEmailEvent(event: EventRow, icsSequence: number): RsvpEmailEvent {
  return {
    id: event.id,
    name: event.name,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    timezone: event.timezone,
    location: event.location,
    lead_name: event.lead_name,
    lead_phone: event.lead_phone,
    lead_email: event.lead_email,
    custom_email_note: event.custom_email_note,
    ics_sequence: icsSequence,
  };
}

function sectionsLabel(ids: string[] | null | undefined): string {
  const set = new Set(ids ?? []);
  const labels = REGISTRATION_SECTIONS.filter((s) => set.has(s.id)).map((s) => s.title);
  return labels.length > 0 ? labels.join(", ") : "None";
}

function capacityLabel(n: number | null): string {
  return n == null ? "Unlimited" : String(n);
}

function buildDiff(before: EventRow, after: EventRow): EventChangeDiffEntry[] {
  const entries: EventChangeDiffEntry[] = [];
  const push = (label: string, b: string, a: string) => {
    if (b !== a) entries.push({ label, before: b, after: a });
  };

  push("Title", before.name, after.name);
  push("Description", before.description ?? "", after.description ?? "");
  push("Location", before.location ?? "", after.location ?? "");
  push("Capacity", capacityLabel(before.capacity), capacityLabel(after.capacity));
  push("Lead name", before.lead_name ?? "", after.lead_name ?? "");
  push("Lead phone", before.lead_phone ?? "", after.lead_phone ?? "");
  push("Lead email", before.lead_email ?? "", after.lead_email ?? "");
  push("Custom email note", before.custom_email_note ?? "", after.custom_email_note ?? "");
  push(
    "Registration sections",
    sectionsLabel(before.registration_sections),
    sectionsLabel(after.registration_sections),
  );
  push(
    "When",
    formatEventDateRange(before.starts_at, before.ends_at, before.timezone),
    formatEventDateRange(after.starts_at, after.ends_at, after.timezone),
  );

  return entries;
}

export type EventEditInput = {
  name: string;
  description: string;
  location: string;
  /** Raw form text — "" means unlimited. */
  capacity: string;
  leadName: string;
  leadPhone: string;
  leadEmail: string;
  customEmailNote: string;
  /** Optional section ids only (lib/registration-sections.ts) — an
   * alwaysRequired section applies to every event regardless and isn't part
   * of this list. */
  registrationSections: string[];
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM", 24-hour */
  time: string;
  /** "HH:MM", 24-hour — "" means open-ended (ends_at stays null). */
  endTime: string;
  timezone: string;
};

export type UpdateEventResult =
  | { ok: true; needsNotifyDecision: true; confirmedCount: number }
  | { ok: true; needsNotifyDecision: false }
  | { ok: false; error: string };

/**
 * Saves an event edit. When the date, time, or location changes and the
 * event has confirmed RSVPs, this first returns needsNotifyDecision (no
 * write yet) so the UI can ask "notify attendees?" — the caller then calls
 * back with an explicit `notifyAttendees` to actually commit the change.
 * The admin change-notification email (item 4) always fires on a real
 * write, independent of that attendee-notify choice.
 */
export async function updateEventAction(
  eventId: number,
  input: EventEditInput,
  notifyAttendees: boolean | null,
): Promise<UpdateEventResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const before = await loadEvent(supabase, eventId);
  if (!before) return { ok: false, error: "Event not found" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Title is required" };
  if (!input.date || !input.time) return { ok: false, error: "Date and time are required" };
  if (!input.timezone) return { ok: false, error: "Time zone is required" };

  const capacityTrimmed = input.capacity.trim();
  const capacity = capacityTrimmed === "" ? null : Number(capacityTrimmed);
  if (capacity != null && (!Number.isFinite(capacity) || capacity < 0)) {
    return { ok: false, error: "Capacity must be a positive number" };
  }

  const validSectionIds = new Set(
    REGISTRATION_SECTIONS.filter((s) => !s.alwaysRequired).map((s) => s.id),
  );
  const registrationSections = input.registrationSections.filter((id) => validSectionIds.has(id));

  const newStarts = zonedDateTimeToUtc(input.date, input.time, input.timezone);

  let newEnds: Date | null = null;
  if (input.endTime.trim()) {
    newEnds = zonedDateTimeToUtc(input.date, input.endTime, input.timezone);
    if (newEnds.getTime() <= newStarts.getTime()) {
      return { ok: false, error: "End time must be after the start time" };
    }
  }

  const after: EventRow = {
    ...before,
    name,
    description: input.description.trim() || null,
    location: input.location.trim() || null,
    capacity,
    lead_name: input.leadName.trim() || null,
    lead_phone: input.leadPhone.trim() || null,
    lead_email: input.leadEmail.trim() || null,
    custom_email_note: input.customEmailNote.trim() || null,
    registration_sections: registrationSections,
    starts_at: newStarts.toISOString(),
    ends_at: newEnds ? newEnds.toISOString() : null,
    timezone: input.timezone,
  };

  const dateTimeOrLocationChanged =
    before.starts_at !== after.starts_at ||
    (before.ends_at ?? null) !== (after.ends_at ?? null) ||
    (before.location ?? null) !== (after.location ?? null);

  if (dateTimeOrLocationChanged && notifyAttendees === null) {
    const confirmedCount = await countConfirmedRsvps(supabase, eventId);
    if (confirmedCount > 0) {
      return { ok: true, needsNotifyDecision: true, confirmedCount };
    }
  }

  const shouldBumpSequence = dateTimeOrLocationChanged;
  const newSequence = shouldBumpSequence ? before.ics_sequence + 1 : before.ics_sequence;

  const { error: updateError } = await supabase
    .from("events")
    .update({
      name: after.name,
      description: after.description,
      location: after.location,
      capacity: after.capacity,
      lead_name: after.lead_name,
      lead_phone: after.lead_phone,
      lead_email: after.lead_email,
      custom_email_note: after.custom_email_note,
      registration_sections: after.registration_sections,
      starts_at: after.starts_at,
      ends_at: after.ends_at,
      timezone: after.timezone,
      ics_sequence: newSequence,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId);
  if (updateError) return { ok: false, error: updateError.message };

  // More room than before: spots that just opened go to the waitlist, same
  // as if someone had cancelled.
  const capacityGrew =
    before.capacity != null && (after.capacity == null || after.capacity > before.capacity);
  if (capacityGrew) {
    await offerFreeSpots(eventId);
  }

  if (notifyAttendees === true && dateTimeOrLocationChanged) {
    try {
      const emails = await confirmedRsvpEmails(supabase, eventId);
      const emailEvent = toEmailEvent(after, newSequence);
      for (const toEmail of emails) {
        try {
          await sendEventUpdateEmail({ event: emailEvent, toEmail });
        } catch (err) {
          console.error(
            `Failed to send event-update email to ${toEmail} for event ${eventId}:`,
            err,
          );
        }
      }
    } catch (err) {
      console.error(`Failed to notify attendees of event ${eventId} update:`, err);
    }
  }

  try {
    const diff = buildDiff(before, after);
    if (diff.length > 0) {
      await sendAdminChangeNotificationEmail({
        action: "edited",
        actorLabel: actorLabel(adminCheck.actor),
        eventName: after.name,
        eventId: after.id,
        diff,
      });
    }
  } catch (err) {
    console.error(`Failed to send admin change notification for event ${eventId} edit:`, err);
  }

  return { ok: true, needsNotifyDecision: false };
}

export type CancelPreviewResult =
  | { ok: true; subject: string; html: string; text: string; recipientCount: number }
  | { ok: false; error: string };

/** Renders the exact cancellation email and counts recipients — no writes,
 * no sends. Backs the admin cancel flow's required preview step. */
export async function previewEventCancellationAction(
  eventId: number,
  reason: string,
): Promise<CancelPreviewResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const trimmedReason = reason.trim();
  if (!trimmedReason) return { ok: false, error: "A cancellation reason is required" };

  const event = await loadEvent(supabase, eventId);
  if (!event) return { ok: false, error: "Event not found" };

  const emails = await confirmedRsvpEmails(supabase, eventId);
  const { subject, html, text } = previewEventCancellationEmail(
    toEmailEvent(event, event.ics_sequence + 1),
    trimmedReason,
  );

  return { ok: true, subject, html, text, recipientCount: emails.length };
}

export type CancelEventResult = { ok: true } | { ok: false; error: string };

/**
 * Cancels the event (status -> 'cancelled', bumped ics_sequence) and emails
 * every confirmed attendee a METHOD:CANCEL update plus the admin
 * notification list — always, regardless of who's on that list.
 */
export async function cancelEventAction(
  eventId: number,
  reason: string,
): Promise<CancelEventResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const trimmedReason = reason.trim();
  if (!trimmedReason) return { ok: false, error: "A cancellation reason is required" };

  const before = await loadEvent(supabase, eventId);
  if (!before) return { ok: false, error: "Event not found" };

  const newSequence = before.ics_sequence + 1;

  const { error: updateError } = await supabase
    .from("events")
    .update({
      status: "cancelled",
      cancellation_reason: trimmedReason,
      cancelled_at: new Date().toISOString(),
      ics_sequence: newSequence,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId);
  if (updateError) return { ok: false, error: updateError.message };

  const emailEvent = toEmailEvent(before, newSequence);

  try {
    const emails = await confirmedRsvpEmails(supabase, eventId);
    for (const toEmail of emails) {
      try {
        await sendEventCancellationEmail({ event: emailEvent, toEmail, reason: trimmedReason });
      } catch (err) {
        console.error(
          `Failed to send event-cancellation email to ${toEmail} for event ${eventId}:`,
          err,
        );
      }
    }
  } catch (err) {
    console.error(`Failed to notify attendees of event ${eventId} cancellation:`, err);
  }

  try {
    await sendAdminChangeNotificationEmail({
      action: "cancelled",
      actorLabel: actorLabel(adminCheck.actor),
      eventName: before.name,
      eventId: before.id,
      diff: [{ label: "Status", before: "Scheduled", after: "Cancelled" }],
      reason: trimmedReason,
    });
  } catch (err) {
    console.error(
      `Failed to send admin change notification for event ${eventId} cancellation:`,
      err,
    );
  }

  return { ok: true };
}

export type RestoreEventResult = { ok: true } | { ok: false; error: string };

/**
 * Restores a cancelled event: status -> 'scheduled', reason cleared, bumped
 * ics_sequence. Optionally emails everyone who has a confirmed RSVP (their
 * row was never touched by the cancellation, so this is still accurate) a
 * fresh METHOD:REQUEST so the event reappears on their calendar. The admin
 * notification fires either way, same as edit/cancel.
 */
export async function restoreEventAction(
  eventId: number,
  notifyAttendees: boolean,
): Promise<RestoreEventResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const before = await loadEvent(supabase, eventId);
  if (!before) return { ok: false, error: "Event not found" };
  if (before.status !== "cancelled") return { ok: false, error: "Event is not cancelled" };

  const newSequence = before.ics_sequence + 1;

  const { error: updateError } = await supabase
    .from("events")
    .update({
      status: "scheduled",
      cancellation_reason: null,
      cancelled_at: null,
      ics_sequence: newSequence,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId);
  if (updateError) return { ok: false, error: updateError.message };

  const emailEvent = toEmailEvent(before, newSequence);

  if (notifyAttendees) {
    try {
      const emails = await confirmedRsvpEmails(supabase, eventId);
      for (const toEmail of emails) {
        try {
          await sendEventRestoredEmail({ event: emailEvent, toEmail });
        } catch (err) {
          console.error(
            `Failed to send event-restored email to ${toEmail} for event ${eventId}:`,
            err,
          );
        }
      }
    } catch (err) {
      console.error(`Failed to notify attendees of event ${eventId} restore:`, err);
    }
  }

  try {
    const diff: EventChangeDiffEntry[] = [{ label: "Status", before: "Cancelled", after: "Scheduled" }];
    if (before.cancellation_reason) {
      diff.push({ label: "Cancellation reason", before: before.cancellation_reason, after: "" });
    }
    await sendAdminChangeNotificationEmail({
      action: "restored",
      actorLabel: actorLabel(adminCheck.actor),
      eventName: before.name,
      eventId: before.id,
      diff,
    });
  } catch (err) {
    console.error(`Failed to send admin change notification for event ${eventId} restore:`, err);
  }

  return { ok: true };
}
