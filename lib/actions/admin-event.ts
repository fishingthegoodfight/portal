"use server";

import { createClient } from "@/lib/supabase/server";
import { actorLabel, requireAdmin } from "@/lib/admin/require-admin";
import { formatEventDateRange } from "@/lib/format-date";
import { zonedDateTimeToUtc } from "@/lib/timezone";
import {
  isSectionComplete,
  profileValueFromColumn,
  REGISTRATION_SECTIONS,
} from "@/lib/registration-sections";
import {
  previewEventCancellationEmail,
  sendAdminChangeNotificationEmail,
  sendEventCancellationEmail,
  sendEventRestoredEmail,
  sendEventUpdateEmail,
  type RsvpEmailEvent,
} from "@/lib/email/send";
import type { EventChangeDiffEntry } from "@/lib/email/templates";
import { expireExcessOffers, offerFreeSpots } from "@/lib/waitlist";
import { capacityError, parseCapacity } from "@/lib/event-capacity";
import { composeLocation, isLocationEmpty, locationErrors } from "@/lib/event-location";
import { CHAPTERS, isVirtualChapter } from "@/lib/chapters";
import {
  isWaiverState,
  resolveEventWaiver,
  waiverStateForChapter,
  WAIVER_STATES,
} from "@/lib/waivers";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type EventRow = {
  id: number;
  name: string;
  event_type: string | null;
  description: string | null;
  occurrence_note: string | null;
  location: string | null;
  venue_name: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  virtual_link: string | null;
  virtual_access_notes: string | null;
  capacity: number | null;
  lead_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  custom_email_note: string | null;
  registration_sections: string[] | null;
  chapter: string | null;
  waiver_state: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  ics_sequence: number;
  status: string;
  cancellation_reason: string | null;
};

const EVENT_COLUMNS =
  "id, name, event_type, description, occurrence_note, location, venue_name, street_address, city, state, virtual_link, virtual_access_notes, capacity, lead_name, lead_phone, lead_email, custom_email_note, registration_sections, chapter, waiver_state, starts_at, ends_at, timezone, ics_sequence, status, cancellation_reason";

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

async function countSignatures(
  supabase: SupabaseServerClient,
  waiverId: number | null,
  userIds: string[],
): Promise<number> {
  if (waiverId == null || userIds.length === 0) return 0;
  const { count } = await supabase
    .from("waiver_signatures")
    .select("*", { count: "exact", head: true })
    .eq("waiver_id", waiverId)
    .in("user_id", userIds);
  return count ?? 0;
}

/** Who is affected when the event's waiver state changes, or null when
 * nobody is registered. Read before anything is written. */
async function waiverChangeImpact(
  supabase: SupabaseServerClient,
  before: EventRow,
  after: EventRow,
): Promise<WaiverChangeImpact | null> {
  const { data: rsvps } = await supabase
    .from("rsvps")
    .select("user_id")
    .eq("event_id", before.id)
    .in("status", ["confirmed", "waitlisted", "offered"]);
  const userIds = (rsvps ?? []).map((r) => r.user_id as string);
  if (userIds.length === 0) return null;

  const oldRequirement = await resolveEventWaiver(supabase, before);
  const newRequirement = await resolveEventWaiver(supabase, after);
  const oldState = waiverStateForChapter(before.chapter) ?? before.waiver_state;
  const newState = after.waiver_state;

  return {
    oldStateName: isWaiverState(oldState) ? WAIVER_STATES[oldState] : "previous",
    newStateName: isWaiverState(newState) ? WAIVER_STATES[newState] : "new",
    registeredCount: userIds.length,
    signedOldCount: await countSignatures(
      supabase,
      oldRequirement.kind === "ok" ? oldRequirement.waiver.id : null,
      userIds,
    ),
    alreadySignedNewCount: await countSignatures(
      supabase,
      newRequirement.kind === "ok" ? newRequirement.waiver.id : null,
      userIds,
    ),
    newWaiverMissing: newRequirement.kind !== "ok",
  };
}

async function confirmedAttendees(
  supabase: SupabaseServerClient,
  eventId: number,
): Promise<{ userId: string; email: string }[]> {
  const { data: rsvps } = await supabase
    .from("rsvps")
    .select("user_id")
    .eq("event_id", eventId)
    .eq("status", "confirmed");
  const userIds = (rsvps ?? []).map((r) => r.user_id as string);
  if (userIds.length === 0) return [];

  const { data: profiles } = await supabase.from("profiles").select("id, email").in("id", userIds);
  return (profiles ?? [])
    .filter((p) => Boolean(p.email))
    .map((p) => ({ userId: p.id as string, email: p.email as string }));
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
    occurrence_note: event.occurrence_note,
    virtual_link: event.virtual_link,
    virtual_access_notes: event.virtual_access_notes,
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
  push("Event type", before.event_type ?? "", after.event_type ?? "");
  push("Chapter", before.chapter ?? "", after.chapter ?? "");
  push("Description", before.description ?? "", after.description ?? "");
  push("Occurrence note", before.occurrence_note ?? "", after.occurrence_note ?? "");
  push("Location", before.location ?? "", after.location ?? "");
  push("Meeting link", before.virtual_link ?? "", after.virtual_link ?? "");
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
  const stateLabel = (code: string | null) =>
    isWaiverState(code) ? WAIVER_STATES[code] : "";
  push("Waiver state", stateLabel(before.waiver_state), stateLabel(after.waiver_state));
  push(
    "When",
    formatEventDateRange(before.starts_at, before.ends_at, before.timezone),
    formatEventDateRange(after.starts_at, after.ends_at, after.timezone),
  );

  return entries;
}

export type EventEditInput = {
  name: string;
  /** A name from `event_types` (active or not — see EventTypeField), or the
   * event's existing legacy value. Changing it never re-defaults the
   * registration sections. */
  eventType: string;
  /** Must be one of lib/chapters.ts — also decides which state's waiver applies. */
  chapter: string;
  description: string;
  /** Public, shown on the events list/event page and in the confirmation
   * and reminder emails — distinct from customEmailNote below. */
  occurrenceNote: string;
  // Structured location — same fields as the create wizard. Composed into
  // events.location on save (see lib/event-location.ts).
  venueName: string;
  streetAddress: string;
  city: string;
  state: string;
  /** Required, ignored otherwise, when chapter is VIRTUAL_CHAPTER. */
  virtualLink: string;
  virtualAccessNotes: string;
  /** Raw form text — "" means unlimited, otherwise at least 1 (lib/event-capacity.ts). */
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

/** What moving an event to a chapter in a different state does to the people
 * already registered: they signed the old state's waiver, not the new one's. */
export type WaiverChangeImpact = {
  oldStateName: string;
  newStateName: string;
  /** Confirmed, waitlisted, or offered — everyone holding or awaiting a spot. */
  registeredCount: number;
  /** How many of them have a valid signature on the old state's waiver. */
  signedOldCount: number;
  /** How many already have a valid signature on the new state's waiver (so
   * won't be asked again). */
  alreadySignedNewCount: number;
  /** True when no waiver has been published yet for the new state + year. */
  newWaiverMissing: boolean;
};

/** Something the admin should confirm before an edit is saved. Returned (with
 * nothing written) until they confirm; several can apply at once. */
export type EditWarning =
  | ({ kind: "waiver"; severity: "warning" } & WaiverChangeImpact)
  | {
      kind: "capacity";
      severity: "warning" | "strong";
      newCapacity: number;
      confirmedCount: number;
      /** How many confirmed people exceed the new capacity (0 if none). */
      overBy: number;
      openOffers: number;
      /** Open offers that no longer fit and will be expired (and emailed). */
      offersDisplaced: number;
    }
  | { kind: "past_date"; severity: "warning"; registeredCount: number }
  | { kind: "sections_removed"; severity: "warning"; titles: string[] }
  | {
      kind: "sections_added";
      severity: "warning";
      registeredCount: number;
      sections: { title: string; missingCount: number }[];
    };

export type UpdateEventResult =
  | { ok: true; needsConfirm: true; warnings: EditWarning[] }
  | { ok: true; needsNotifyDecision: true; confirmedCount: number }
  | { ok: true; needsNotifyDecision: false }
  | { ok: false; error: string };

const sectionTitleById = (id: string) =>
  REGISTRATION_SECTIONS.find((s) => s.id === id)?.title ?? id;

/** The people holding or awaiting a spot, with what they've answered so far —
 * read once and reused for every warning. */
async function loadRegistrants(supabase: SupabaseServerClient, eventId: number) {
  const { data: rsvps } = await supabase
    .from("rsvps")
    .select("user_id, status")
    .eq("event_id", eventId)
    .in("status", ["confirmed", "waitlisted", "offered"]);
  const rows = (rsvps ?? []) as { user_id: string; status: string }[];
  return {
    userIds: rows.map((r) => r.user_id),
    confirmedCount: rows.filter((r) => r.status === "confirmed").length,
    offeredCount: rows.filter((r) => r.status === "offered").length,
  };
}

/** How many of these people haven't answered a section yet (per their profile). */
async function countMissingAnswers(
  supabase: SupabaseServerClient,
  sectionId: string,
  userIds: string[],
): Promise<number> {
  const section = REGISTRATION_SECTIONS.find((s) => s.id === sectionId);
  if (!section || userIds.length === 0) return 0;
  const { data: profiles } = await supabase.from("profiles").select("*").in("id", userIds);
  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));
  let missing = 0;
  for (const userId of userIds) {
    const profile = byId.get(userId);
    const values: Record<string, string> = {};
    for (const field of section.fields) {
      values[field.key] = profileValueFromColumn(field, profile?.[field.key]);
    }
    if (!isSectionComplete(section, values)) missing++;
  }
  return missing;
}

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
  /** The admin has confirmed the warnings returned by an earlier call (see
   * EditWarning). Pass true on the follow-up call to actually save. */
  confirmed = false,
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

  // One rule with the create wizard: blank = unlimited, otherwise at least 1.
  const capacityProblem = capacityError(input.capacity);
  if (capacityProblem) return { ok: false, error: capacityProblem };
  const capacity = parseCapacity(input.capacity);

  // Event type: any event_types row (active or not — the edit form offers
  // both, so an already-deactivated type stays selectable), or left
  // unchanged (an older event may carry a value that predates the table
  // entirely).
  if (input.eventType !== before.event_type) {
    const { data: eventTypeRow } = await supabase
      .from("event_types")
      .select("id")
      .eq("name", input.eventType)
      .maybeSingle();
    if (!eventTypeRow) return { ok: false, error: "Choose an event type" };
  }

  const validSectionIds = new Set(
    REGISTRATION_SECTIONS.filter((s) => !s.alwaysRequired && !s.profileOnly).map((s) => s.id),
  );
  const registrationSections = input.registrationSections.filter((id) => validSectionIds.has(id));

  // The chapter also decides the waiver: its state is never a separate
  // choice, it always follows the chapter.
  if (!CHAPTERS.some((c) => c.name === input.chapter) && !isVirtualChapter(input.chapter)) {
    return { ok: false, error: "Choose a chapter" };
  }
  const waiverState = waiverStateForChapter(input.chapter);
  const isVirtual = isVirtualChapter(input.chapter);

  // Same four fields and rule as the create wizard. An older event that only
  // has free text keeps it if the admin leaves all four blank. A virtual
  // event skips physical-location validation entirely and needs a meeting
  // link instead.
  const virtualLink = input.virtualLink.trim();
  const virtualAccessNotes = input.virtualAccessNotes.trim();
  if (isVirtual) {
    if (!virtualLink) return { ok: false, error: "A meeting link is required for a virtual event" };
  } else {
    const locationProblems = locationErrors(input, { allowLegacyEmpty: true });
    if (locationProblems.length > 0) return { ok: false, error: locationProblems.join("; ") };
  }
  const keepLegacyLocation = !isVirtual && isLocationEmpty(input);

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
    event_type: input.eventType,
    chapter: input.chapter,
    description: input.description.trim() || null,
    occurrence_note: input.occurrenceNote.trim() || null,
    // Physical location and virtual details are mutually exclusive — moving
    // an event to/from "Virtual" clears whichever side no longer applies
    // instead of leaving a stale address or link behind.
    location: isVirtual ? null : keepLegacyLocation ? before.location : composeLocation(input),
    venue_name: isVirtual ? null : keepLegacyLocation ? before.venue_name : input.venueName.trim(),
    street_address: isVirtual
      ? null
      : keepLegacyLocation
        ? before.street_address
        : input.streetAddress.trim(),
    city: isVirtual ? null : keepLegacyLocation ? before.city : input.city.trim(),
    state: isVirtual ? null : keepLegacyLocation ? before.state : input.state.trim(),
    virtual_link: isVirtual ? virtualLink : null,
    virtual_access_notes: isVirtual ? virtualAccessNotes || null : null,
    capacity,
    lead_name: input.leadName.trim() || null,
    lead_phone: input.leadPhone.trim() || null,
    lead_email: input.leadEmail.trim() || null,
    custom_email_note: input.customEmailNote.trim() || null,
    registration_sections: registrationSections,
    waiver_state: waiverState,
    starts_at: newStarts.toISOString(),
    ends_at: newEnds ? newEnds.toISOString() : null,
    timezone: input.timezone,
  };

  // A chapter change counts like a location change: attendees are offered the
  // "notify" choice for it too. A changed meeting link is the virtual
  // equivalent of a changed physical location — same treatment, so the .ics
  // (LOCATION/DESCRIPTION — see lib/email/ics.ts) gets updated and attendees
  // can be told.
  const chapterChanged = (before.chapter ?? null) !== (after.chapter ?? null);
  const virtualLinkChanged = (before.virtual_link ?? null) !== (after.virtual_link ?? null);
  const dateTimeOrLocationChanged =
    before.starts_at !== after.starts_at ||
    (before.ends_at ?? null) !== (after.ends_at ?? null) ||
    (before.location ?? null) !== (after.location ?? null) ||
    chapterChanged ||
    virtualLinkChanged;

  // Anything the admin should confirm first — nothing is written until they do.
  if (!confirmed) {
    const warnings: EditWarning[] = [];
    const registrants = await loadRegistrants(supabase, eventId);

    // Moving to a chapter in the other state (CO <-> GA) swaps the waiver:
    // registered people signed the old state's, so they'll need to sign the new
    // one. Within the same state (Denver -> CO Springs) nothing changes for them.
    if (before.waiver_state !== after.waiver_state) {
      const impact = await waiverChangeImpact(supabase, before, after);
      if (impact) warnings.push({ kind: "waiver", severity: "warning", ...impact });
    }

    // Lowering capacity: nobody is removed, but confirmed people can end up over
    // the new limit, and open waitlist offers that no longer fit get expired.
    if (after.capacity != null && after.capacity !== before.capacity) {
      const overBy = Math.max(registrants.confirmedCount - after.capacity, 0);
      const room = Math.max(after.capacity - registrants.confirmedCount, 0);
      const offersDisplaced = Math.max(registrants.offeredCount - room, 0);
      if (overBy > 0 || offersDisplaced > 0) {
        warnings.push({
          kind: "capacity",
          severity: offersDisplaced > 0 ? "strong" : "warning",
          newCapacity: after.capacity,
          confirmedCount: registrants.confirmedCount,
          overBy,
          openOffers: registrants.offeredCount,
          offersDisplaced,
        });
      }
    }

    // Moving the start into the past for an event people have signed up for.
    if (
      before.starts_at !== after.starts_at &&
      new Date(after.starts_at).getTime() < Date.now() &&
      registrants.userIds.length > 0
    ) {
      warnings.push({
        kind: "past_date",
        severity: "warning",
        registeredCount: registrants.userIds.length,
      });
    }

    // Registration sections: removing stops collecting them; adding leaves
    // people who already registered without an answer.
    const beforeSections = new Set(before.registration_sections ?? []);
    const afterSections = new Set(after.registration_sections ?? []);
    const removed = [...beforeSections].filter((id) => !afterSections.has(id));
    const added = [...afterSections].filter((id) => !beforeSections.has(id));
    if (removed.length > 0) {
      warnings.push({
        kind: "sections_removed",
        severity: "warning",
        titles: removed.map(sectionTitleById),
      });
    }
    if (added.length > 0 && registrants.userIds.length > 0) {
      warnings.push({
        kind: "sections_added",
        severity: "warning",
        registeredCount: registrants.userIds.length,
        sections: await Promise.all(
          added.map(async (id) => ({
            title: sectionTitleById(id),
            missingCount: await countMissingAnswers(supabase, id, registrants.userIds),
          })),
        ),
      });
    }

    if (warnings.length > 0) return { ok: true, needsConfirm: true, warnings };
  }

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
      event_type: after.event_type,
      chapter: after.chapter,
      description: after.description,
      occurrence_note: after.occurrence_note,
      location: after.location,
      venue_name: after.venue_name,
      street_address: after.street_address,
      city: after.city,
      state: after.state,
      virtual_link: after.virtual_link,
      virtual_access_notes: after.virtual_access_notes,
      capacity: after.capacity,
      lead_name: after.lead_name,
      lead_phone: after.lead_phone,
      lead_email: after.lead_email,
      custom_email_note: after.custom_email_note,
      registration_sections: after.registration_sections,
      waiver_state: after.waiver_state,
      starts_at: after.starts_at,
      ends_at: after.ends_at,
      timezone: after.timezone,
      ics_sequence: newSequence,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId);
  if (updateError) return { ok: false, error: updateError.message };

  // Less room than before: expire any open offers that no longer fit and send
  // those people the usual "offer lapsed" email.
  if (after.capacity != null && after.capacity !== before.capacity) {
    await expireExcessOffers(eventId);
  }

  // More room than before: spots that just opened go to the waitlist, same
  // as if someone had cancelled.
  const capacityGrew =
    before.capacity != null && (after.capacity == null || after.capacity > before.capacity);
  if (capacityGrew) {
    await offerFreeSpots(eventId);
  }

  if (notifyAttendees === true && dateTimeOrLocationChanged) {
    try {
      const attendees = await confirmedAttendees(supabase, eventId);
      const emailEvent = toEmailEvent(after, newSequence);

      // When the update moved the event to the other state's waiver, tell the
      // attendees who still have to sign it (anyone who already signed the new
      // state's waiver for this year gets the usual wording).
      let signedNewWaiver = new Set<string>();
      const waiverStateChanged = before.waiver_state !== after.waiver_state;
      if (waiverStateChanged) {
        const requirement = await resolveEventWaiver(supabase, after);
        if (requirement.kind === "ok" && attendees.length > 0) {
          const { data: signatures } = await supabase
            .from("waiver_signatures")
            .select("user_id")
            .eq("waiver_id", requirement.waiver.id)
            .in(
              "user_id",
              attendees.map((a) => a.userId),
            );
          signedNewWaiver = new Set((signatures ?? []).map((s) => s.user_id as string));
        }
      }
      const newWaiverStateName =
        waiverStateChanged && isWaiverState(after.waiver_state)
          ? WAIVER_STATES[after.waiver_state]
          : undefined;

      for (const { userId, email: toEmail } of attendees) {
        try {
          await sendEventUpdateEmail({
            event: emailEvent,
            toEmail,
            newWaiverStateName: signedNewWaiver.has(userId) ? undefined : newWaiverStateName,
          });
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
