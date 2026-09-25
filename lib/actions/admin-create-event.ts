"use server";

import { randomUUID } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { actorLabel, requireChapterManager } from "@/lib/admin/require-admin";
import { CHAPTERS, isVirtualChapter, timezoneForChapter } from "@/lib/chapters";
import { formatEventDateRange } from "@/lib/format-date";
import { generateRecurrenceDates, type RecurrenceFrequency } from "@/lib/admin/recurrence";
import { REGISTRATION_SECTIONS } from "@/lib/registration-sections";
import { sendAdminChangeNotificationEmail } from "@/lib/email/send";
import type { EventChangeDiffEntry } from "@/lib/email/templates";
import { zonedDateTimeToUtc } from "@/lib/timezone";
import { capacityError, parseCapacity } from "@/lib/event-capacity";
import { composeLocation, locationErrors } from "@/lib/event-location";
import { waiverStateForChapter } from "@/lib/waivers";
import {
  friendlyEventDbError,
  type EventFormField,
  type EventFormProblem,
  type EventFormStep,
} from "@/lib/event-db-errors";

export type VolunteerRoleInput = {
  title: string;
  description: string;
  /** "HH:MM", same calendar date as the event occurrence it belongs to. */
  shiftStart: string;
  shiftEnd: string;
  whatToBring: string;
  /** Raw form text. */
  numberNeeded: string;
  /** volunteer_role_types.id as a string, or "" for a plain free-text role
   * with no catalog role type behind it. */
  roleTypeId: string;
};

export type CreateEventInput = {
  // Step 1 — Basics
  /** event_templates.id as a string, or "" when no template was used —
   * stored as events.created_from_template_id (provenance only). */
  templateId: string;
  chapter: string;
  eventType: string;
  title: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  time: string;
  /** "HH:MM" — blank means an open-ended event (ends_at stays null). */
  endTime: string;
  timezone: string;
  // Step 2 — Details
  venueName: string;
  streetAddress: string;
  city: string;
  state: string;
  /** Optional ZIP. */
  postalCode: string;
  /** Required, ignored otherwise, when chapter is VIRTUAL_CHAPTER. */
  virtualLink: string;
  virtualAccessNotes: string;
  description: string;
  /** Public, shown on the events list/event page and in the confirmation
   * and reminder emails — distinct from customEmailNote below. Never
   * pre-filled by a template. */
  occurrenceNote: string;
  /** Raw form text — blank means unlimited; otherwise at least 1. */
  capacity: string;
  leadName: string;
  leadEmail: string;
  leadPhone: string;
  /** profiles.id of the lead's account, or "" for none — that person gets
   * manage rights on the event (can_manage_event). */
  leadUserId: string;
  /** Shown in the RSVP confirmation email, if set. */
  customEmailNote: string;
  registrationSections: string[];
  /** Everyone at the event needs a current health form
   * (events.requires_health_history). */
  requiresHealthHistory: boolean;
  // Step 3 — Volunteers
  volunteersNeeded: boolean;
  volunteerRoles: VolunteerRoleInput[];
  // Step 4 — Recurrence
  recurrence: "none" | RecurrenceFrequency;
  /** "YYYY-MM-DD" — required, ignored, when recurrence is "none". */
  recurrenceEndDate: string;
  /** Tier 1 marketing (events.marketing_tier = 1). One-time events only — a
   * boost is always one occurrence, so a series is created unboosted and an
   * occurrence boosted afterwards from its edit form. */
  boostTier1: boolean;
};

export type CreateEventResult =
  | { ok: true; eventIds: number[]; seriesId: string | null }
  /** `step` / `field`: where in the wizard the problem is, when it's one
   * field's (see lib/event-db-errors.ts) — the wizard goes back there. */
  | { ok: false; error: string; step?: EventFormStep; field?: EventFormField };

function fail(error: string, step?: EventFormStep, field?: EventFormField): CreateEventResult {
  return { ok: false, error, step, field };
}

function failWith(problem: EventFormProblem, prefix = ""): CreateEventResult {
  return { ok: false, error: prefix + problem.message, step: problem.step, field: problem.field };
}

/**
 * Creates one event, or (for a repeating choice) up to
 * MAX_RECURRENCE_OCCURRENCES event rows sharing a fresh series_id — each a
 * full, independent row, generated and inserted one at a time (not a single
 * bulk insert) so a created id always unambiguously corresponds to the
 * occurrence date that produced it, needed to compute that occurrence's own
 * volunteer shift times. A failure partway through a series leaves the
 * occurrences already created in place — the error message says how many
 * that was, since this project has no cross-statement transaction RPC to
 * make the whole series atomic.
 */
export async function createEventAction(input: CreateEventInput): Promise<CreateEventResult> {
  const supabase = await createClient();
  // --- Step 1: Basics ---
  const title = input.title.trim();
  if (!title) return fail("Event title is required", 1, "title");
  if (!CHAPTERS.some((c) => c.name === input.chapter) && !isVirtualChapter(input.chapter)) {
    return fail("Choose a chapter", 1, "chapter");
  }
  // Admins, and chapter leads for their own chapters (can_manage_chapter).
  // A chapter lead's event goes live immediately, same as an admin's.
  const adminCheck = await requireChapterManager(supabase, input.chapter);
  if ("error" in adminCheck) return fail(adminCheck.error, 1, "chapter");
  if (input.leadUserId && !/^[0-9a-f-]{36}$/i.test(input.leadUserId)) {
    return fail("Choose the lead again", 2, "lead");
  }
  // A new event can only take an active, currently-offered type — unlike
  // editing, where an event may already carry one that's since been
  // deactivated or never existed in event_types at all (see admin-event.ts).
  const { data: eventTypeRow } = await supabase
    .from("event_types")
    .select("id")
    .eq("name", input.eventType)
    .eq("active", true)
    .maybeSingle();
  if (!eventTypeRow) {
    return fail("Choose an event type", 1, "event_type");
  }
  // Provenance only — a template deleted since the wizard loaded just leaves
  // this null rather than failing the create on the FK.
  let templateId: number | null = null;
  if (Number.isInteger(Number(input.templateId)) && input.templateId !== "") {
    const { data: templateRow } = await supabase
      .from("event_templates")
      .select("id")
      .eq("id", Number(input.templateId))
      .maybeSingle();
    templateId = templateRow?.id ?? null;
  }
  if (!input.date || !input.time) {
    return fail("Date and start time are required", 1, "date");
  }
  const timezone = input.timezone || timezoneForChapter(input.chapter);

  const firstStarts = zonedDateTimeToUtc(input.date, input.time, timezone);
  if (input.endTime) {
    const firstEnds = zonedDateTimeToUtc(input.date, input.endTime, timezone);
    if (firstEnds.getTime() <= firstStarts.getTime()) {
      return fail("End time must be after the start time", 1, "time");
    }
  }
  if (firstStarts.getTime() < Date.now()) {
    return fail("Date and time can't be in the past", 1, "date");
  }

  // --- Step 2: Details ---
  const isVirtual = isVirtualChapter(input.chapter);
  const venueName = isVirtual ? "" : input.venueName.trim();
  const streetAddress = isVirtual ? "" : input.streetAddress.trim();
  const city = isVirtual ? "" : input.city.trim();
  const state = isVirtual ? "" : input.state.trim();
  const postalCode = isVirtual ? "" : input.postalCode.trim();
  const virtualLink = isVirtual ? input.virtualLink.trim() : "";
  const virtualAccessNotes = isVirtual ? input.virtualAccessNotes.trim() : "";
  if (isVirtual) {
    if (!virtualLink) return fail("A meeting link is required for a virtual event", 2, "virtual_link");
  } else {
    const locationProblems = locationErrors(input);
    if (locationProblems.length > 0) return fail(locationProblems.join("; "), 2, "venue");
  }
  const capacityProblem = capacityError(input.capacity);
  if (capacityProblem) return fail(capacityProblem, 2, "capacity");
  const capacity = parseCapacity(input.capacity);
  const validSectionIds = new Set(
    REGISTRATION_SECTIONS.filter((s) => !s.alwaysRequired && !s.profileOnly).map((s) => s.id),
  );
  const registrationSections = input.registrationSections.filter((id) => validSectionIds.has(id));
  // Never a choice: the waiver state always follows the chapter. A virtual
  // event resolves to Colorado — see the deliberate-default comment on
  // waiverStateForChapter in lib/waivers.ts.
  const waiverState = waiverStateForChapter(input.chapter);
  const location = isVirtual ? null : composeLocation(input);

  // --- Step 3: Volunteers ---
  const roles = input.volunteersNeeded ? input.volunteerRoles : [];
  for (const role of roles) {
    const roleTitle = role.title.trim();
    if (!roleTitle) return fail("Every volunteer role needs a title", 3, "roles");
    const needed = Number(role.numberNeeded.trim());
    if (!Number.isFinite(needed) || needed < 1) {
      return fail(`"${roleTitle}" needs a number needed of at least 1`, 3, "roles");
    }
    if (!role.shiftStart || !role.shiftEnd) {
      return fail(`"${roleTitle}" needs a shift start and end time`, 3, "roles");
    }
    if (role.shiftEnd <= role.shiftStart) {
      return fail(`"${roleTitle}"'s shift end must be after its start`, 3, "roles");
    }
  }

  // --- Step 4: Recurrence ---
  let occurrenceDates: string[];
  let recurrenceFrequency: RecurrenceFrequency | null = null;
  if (input.recurrence === "none") {
    occurrenceDates = [input.date];
  } else {
    if (!input.recurrenceEndDate) {
      return fail("An end date is required for a repeating event", 4, "recurrence");
    }
    if (input.recurrenceEndDate < input.date) {
      return fail("The repeat end date must be after the start date", 4, "recurrence");
    }
    recurrenceFrequency = input.recurrence;
    occurrenceDates = generateRecurrenceDates(
      input.date,
      input.recurrence,
      input.recurrenceEndDate,
    );
  }

  const seriesId = occurrenceDates.length > 1 ? randomUUID() : null;

  // --- Marketing boost ---
  // Never a whole series. The chapter's month is checked here so the wizard
  // can say which event already has it; events_marketing_guard re-checks on
  // insert.
  const boost = input.boostTier1 === true;
  if (boost && occurrenceDates.length > 1) {
    return fail(
      "A repeating event can't be boosted as a whole — create the series, then boost one occurrence from its edit page",
      4,
      "boost",
    );
  }
  if (boost) {
    const { data: conflict, error: conflictError } = await supabase.rpc("tier1_boost_conflict_message", {
      p_event_id: null,
      p_chapter: input.chapter,
      p_starts_at: firstStarts.toISOString(),
      p_timezone: timezone,
    });
    if (conflictError) return failWith(friendlyEventDbError(conflictError, `boost check "${title}"`));
    if (conflict) return fail(conflict as string, 4, "boost");
  }

  // --- Create ---
  const eventIds: number[] = [];

  for (const occurrenceDate of occurrenceDates) {
    const startsAt = zonedDateTimeToUtc(occurrenceDate, input.time, timezone);
    const endsAt = input.endTime
      ? zonedDateTimeToUtc(occurrenceDate, input.endTime, timezone)
      : null;

    const { data: created, error: insertError } = await supabase
      .from("events")
      .insert({
        name: title,
        chapter: input.chapter,
        event_type: input.eventType,
        description: input.description.trim() || null,
        occurrence_note: input.occurrenceNote.trim() || null,
        created_from_template_id: templateId,
        venue_name: venueName,
        street_address: streetAddress,
        city,
        state,
        postal_code: postalCode || null,
        location,
        virtual_link: virtualLink || null,
        virtual_access_notes: virtualAccessNotes || null,
        capacity,
        spots_taken: 0,
        lead_name: input.leadName.trim() || null,
        lead_email: input.leadEmail.trim() || null,
        lead_phone: input.leadPhone.trim() || null,
        lead_user_id: input.leadUserId || null,
        custom_email_note: input.customEmailNote.trim() || null,
        registration_sections: registrationSections,
        requires_health_history: input.requiresHealthHistory === true,
        waiver_state: waiverState,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt ? endsAt.toISOString() : null,
        timezone,
        is_published: true,
        status: "scheduled",
        series_id: seriesId,
        recurrence_frequency: recurrenceFrequency,
        recurrence_end_date: input.recurrence === "none" ? null : input.recurrenceEndDate,
        marketing_tier: boost ? 1 : null,
      })
      .select("id")
      .single();

    if (insertError || !created) {
      const problem = friendlyEventDbError(insertError ?? {}, `create "${title}" (${occurrenceDate})`);
      return failWith(
        problem,
        eventIds.length > 0
          ? `Created ${eventIds.length} of ${occurrenceDates.length} occurrences, then the one on ${occurrenceDate} failed — check the series before trying again. `
          : "",
      );
    }
    eventIds.push(created.id);

    if (roles.length > 0) {
      const volunteerRows = roles.map((role) => ({
        event_id: created.id,
        role: role.title.trim(),
        description: role.description.trim() || null,
        slots: Number(role.numberNeeded.trim()),
        shift_start: zonedDateTimeToUtc(occurrenceDate, role.shiftStart, timezone).toISOString(),
        shift_end: zonedDateTimeToUtc(occurrenceDate, role.shiftEnd, timezone).toISOString(),
        what_to_bring: role.whatToBring.trim() || null,
        role_type_id: role.roleTypeId ? Number(role.roleTypeId) : null,
      }));
      const { error: volunteerError } = await supabase
        .from("volunteer_opportunities")
        .insert(volunteerRows);
      if (volunteerError) {
        const problem = friendlyEventDbError(volunteerError, `create roles for event ${created.id}`);
        return failWith(
          { ...problem, step: 3, field: "roles" },
          `Created ${eventIds.length} of ${occurrenceDates.length} event(s), but the volunteer roles for ${occurrenceDate} didn't save — check the event before trying again. `,
        );
      }
    }
  }

  try {
    const whenSummary =
      formatEventDateRange(
        zonedDateTimeToUtc(occurrenceDates[0], input.time, timezone).toISOString(),
        input.endTime
          ? zonedDateTimeToUtc(occurrenceDates[0], input.endTime, timezone).toISOString()
          : null,
        timezone,
      ) +
      (occurrenceDates.length > 1
        ? ` (first of ${occurrenceDates.length} occurrences, ${input.recurrence} through ${input.recurrenceEndDate})`
        : "");

    const diff: EventChangeDiffEntry[] = [
      { label: "Chapter", before: "", after: input.chapter },
      { label: "Event type", before: "", after: input.eventType },
      { label: "When", before: "", after: whenSummary },
      isVirtual
        ? { label: "Meeting link", before: "", after: virtualLink }
        : { label: "Location", before: "", after: location ?? "" },
      { label: "Capacity", before: "", after: capacity == null ? "Unlimited" : String(capacity) },
    ];
    if (roles.length > 0) {
      diff.push({
        label: "Volunteer roles",
        before: "",
        after: roles.map((r) => `${r.title.trim()} (${r.numberNeeded.trim()} needed)`).join(", "),
      });
    }

    await sendAdminChangeNotificationEmail({
      action: "created",
      actorLabel: actorLabel(adminCheck.actor),
      eventName: title,
      eventId: eventIds[0],
      chapter: input.chapter,
      diff,
    });
  } catch (err) {
    console.error(`Failed to send admin change notification for newly created event:`, err);
  }

  return { ok: true, eventIds, seriesId };
}
