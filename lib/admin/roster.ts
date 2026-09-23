import { createClient } from "@/lib/supabase/server";
import { formatDateInZone, formatEventDateRange, formatEventInstant } from "@/lib/format-date";
import { resolveEventWaiver, waiverHeading } from "@/lib/waivers";
import { profileValueFromColumn, REGISTRATION_SECTIONS } from "@/lib/registration-sections";

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
  occurrence_note: string | null;
  virtual_link: string | null;
  virtual_access_notes: string | null;
  capacity: number | null;
  spots_taken: number | null;
  lead_name: string | null;
  lead_phone: string | null;
  custom_email_note: string | null;
  registration_sections: string[] | null;
  waiver_state: string | null;
  status: string;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  series_id: string | null;
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
  /** Pre-formatted date they signed this event's waiver, or null if they haven't. */
  waiverSignedOn: string | null;
  /** Every registration field's value from their profile, keyed by column —
   * the event's other sections (sizing, …) are shown from here, same as for
   * volunteers. Dietary keeps using dietaryNotes above. */
  profileFields: Record<string, string>;
};

export type WaitlistPerson = {
  rsvpId: number;
  userId: string;
  /** 'waitlisted' | 'offered' | 'expired' */
  status: string;
  /** 1-based place among people still 'waitlisted'; null for offered/expired. */
  position: number | null;
  /** Pre-formatted in the event's timezone (see formatEventInstant) — this
   * reaches a client component, so it can't be formatted there. */
  joinedLabel: string;
  /** Expiry of an open offer, or when a lapsed one ran out. */
  offerExpiresLabel: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

/** Which waiver applies to the event (every event has one). */
export type RosterWaiver = {
  /** e.g. "2026 Colorado waiver"; null when required but none is published. */
  heading: string | null;
  /** Set when required but no waiver could be found for the event. */
  problem: string | null;
};

/** Whether the event collects a dietary answer, and how many on the roster
 * haven't given one (a "No" counts as answered). */
export type RosterDietary = {
  collected: boolean;
  notAnsweredCount: number;
};

export type VolunteerRosterPerson = {
  signupId: number;
  opportunityId: number;
  role: string;
  /** Pre-formatted in the event's own timezone. */
  shiftLabel: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  emergencyContact: string;
  emergencyPhone: string;
  /** Every registration field's value from their profile, keyed by column —
   * volunteers answer the event's sections (dietary, sizing, …) at signup,
   * saved to the profile, so the roster reads them from there rather than a
   * per-signup copy like rsvps.dietary_notes. */
  profileFields: Record<string, string>;
  checkedInAt: string | null;
};

/** One volunteer role's fill status — every opportunity at the event, even
 * ones with zero confirmed signups, so "filled vs needed" always shows. */
export type VolunteerRoleSummary = {
  opportunityId: number;
  role: string;
  shiftLabel: string;
  slots: number;
  slotsTaken: number;
};

export type EventRoster = {
  event: AdminEventSummary;
  dietary: RosterDietary;
  waiver: RosterWaiver;
  /** Confirmed attendees only, sorted by last name. */
  roster: RosterPerson[];
  /** Everyone waiting or holding/lost an offer, in join order (lapsed
   * offers last). */
  waitlist: WaitlistPerson[];
  /** Every volunteer role at the event, filled vs needed. */
  volunteerRoles: VolunteerRoleSummary[];
  /** Confirmed volunteer signups, sorted by role then last name. */
  volunteerRoster: VolunteerRosterPerson[];
};

/** Every registration field's value from a profile row, keyed by column, in
 * the form the section catalog reads (see profileValueFromColumn). */
function profileFieldsOf(profile: Record<string, unknown> | null | undefined): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const section of REGISTRATION_SECTIONS) {
    for (const field of section.fields) {
      fields[field.key] = profileValueFromColumn(field, profile?.[field.key]);
    }
  }
  return fields;
}

/**
 * Loads an event plus its confirmed roster and, separately, its waitlist
 * (waitlisted / offered / lapsed people) (rsvps joined to profiles in
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
      "id, name, chapter, event_type, starts_at, ends_at, timezone, location, description, occurrence_note, virtual_link, virtual_access_notes, capacity, spots_taken, lead_name, lead_phone, custom_email_note, registration_sections, waiver_state, status, cancellation_reason, cancelled_at, series_id",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (!event) return null;

  const { data: rsvpRows } = await supabase
    .from("rsvps")
    .select("id, user_id, status, checked_in_at, dietary_notes, joined_at, offer_expires_at")
    .eq("event_id", eventId)
    .neq("status", "cancelled");

  const userIds = (rsvpRows ?? []).map((r) => r.user_id as string);

  const { data: profileRows } =
    userIds.length > 0
      ? await supabase
          // * so a new registration section's column is picked up with no
          // edit here — see profileFieldsOf.
          .from("profiles")
          .select("*")
          .in("id", userIds)
      : { data: [] as never[] };

  const profileById = new Map((profileRows ?? []).map((p) => [p.id as string, p]));

  // Waiver status for each person — every event has a waiver.
  let waiverHeadingText: string | null = null;
  let waiverProblem: string | null = null;
  const signedAtByUser = new Map<string, string>();
  const requirement = await resolveEventWaiver(supabase, {
    chapter: event.chapter as string | null,
    waiver_state: event.waiver_state as string | null,
    starts_at: event.starts_at as string,
    timezone: event.timezone as string,
  });
  if (requirement.kind === "ok") {
    waiverHeadingText = waiverHeading(requirement.state, requirement.year);
    if (userIds.length > 0) {
      const { data: signatures } = await supabase
        .from("waiver_signatures")
        .select("user_id, signed_at")
        .eq("waiver_id", requirement.waiver.id)
        .in("user_id", userIds);
      for (const sig of signatures ?? []) {
        signedAtByUser.set(sig.user_id as string, sig.signed_at as string);
      }
    }
  } else {
    waiverProblem =
      requirement.kind === "no_state"
        ? "No waiver state is set for this event."
        : `No ${requirement.year} ${requirement.state} waiver has been published.`;
  }

  const isWaiting = (status: string) =>
    status === "waitlisted" || status === "offered" || status === "expired";

  const roster: RosterPerson[] = (rsvpRows ?? [])
    .filter((r) => !isWaiting(r.status as string))
    .map((r) => {
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
        waiverSignedOn: signedAtByUser.has(r.user_id as string)
          ? formatDateInZone(signedAtByUser.get(r.user_id as string)!, event.timezone as string)
          : null,
        profileFields: profileFieldsOf(profile),
      };
    });

  roster.sort((a, b) =>
    (a.lastName || a.firstName).localeCompare(b.lastName || b.firstName, undefined, {
      sensitivity: "base",
    }),
  );

  const statusRank = (status: string) => (status === "expired" ? 1 : 0);
  const waiting = (rsvpRows ?? [])
    .filter((r) => isWaiting(r.status as string))
    .sort(
      (a, b) =>
        statusRank(a.status as string) - statusRank(b.status as string) ||
        String(a.joined_at ?? "9999").localeCompare(String(b.joined_at ?? "9999")) ||
        (a.id as number) - (b.id as number),
    );

  let nextPosition = 1;
  const waitlist: WaitlistPerson[] = waiting.map((r) => {
    const profile = profileById.get(r.user_id as string);
    const status = r.status as string;
    const expiresAt = r.offer_expires_at as string | null;
    const joinedAt = r.joined_at as string | null;
    return {
      rsvpId: r.id as number,
      userId: r.user_id as string,
      status,
      position: status === "waitlisted" ? nextPosition++ : null,
      joinedLabel: joinedAt ? formatEventInstant(joinedAt, event.timezone as string) : "—",
      offerExpiresLabel: expiresAt ? formatEventInstant(expiresAt, event.timezone as string) : null,
      firstName: (profile?.first_name as string | null) ?? "",
      lastName: (profile?.last_name as string | null) ?? "",
      email: (profile?.email as string | null) ?? "",
      phone: (profile?.phone as string | null) ?? "",
    };
  });

  const collectsDietary =
    (event.registration_sections as string[] | null)?.includes("dietary") ?? false;

  // Volunteer roster — separate from the participant one above. Embeds
  // profiles directly (unlike rsvps): volunteer_signups.user_id references
  // profiles(id), not auth.users(id) independently, so PostgREST can walk it.
  const { data: opportunityRows } = await supabase
    .from("volunteer_opportunities")
    .select("id, role, shift_start, shift_end, slots, slots_taken")
    .eq("event_id", eventId)
    // A cancelled role (edit form, "Cancel role") has no signups left and
    // isn't offered any more.
    .is("cancelled_at", null);

  const opportunities = (opportunityRows ?? []) as {
    id: number;
    role: string;
    shift_start: string;
    shift_end: string;
    slots: number;
    slots_taken: number;
  }[];

  const volunteerRoles: VolunteerRoleSummary[] = opportunities.map((o) => ({
    opportunityId: o.id,
    role: o.role,
    shiftLabel: formatEventDateRange(o.shift_start, o.shift_end, event.timezone as string),
    slots: o.slots,
    slotsTaken: o.slots_taken,
  }));

  let volunteerRoster: VolunteerRosterPerson[] = [];
  if (opportunities.length > 0) {
    const shiftLabelByOpportunity = new Map(volunteerRoles.map((r) => [r.opportunityId, r.shiftLabel]));
    const roleByOpportunity = new Map(opportunities.map((o) => [o.id, o.role]));

    const { data: signupRows } = await supabase
      .from("volunteer_signups")
      // profiles(*) so a new registration section's column is picked up with
      // no edit here, same as the RSVP page's profile read.
      .select("id, opportunity_id, checked_in_at, profile:profiles(*)")
      .in(
        "opportunity_id",
        opportunities.map((o) => o.id),
      )
      .eq("status", "confirmed");

    volunteerRoster = ((signupRows ?? []) as unknown as {
      id: number;
      opportunity_id: number;
      checked_in_at: string | null;
      profile: Record<string, unknown> | null;
    }[]).map((s) => {
      const text = (key: string) => (s.profile?.[key] as string | null | undefined) ?? "";
      const profileFields = profileFieldsOf(s.profile);
      return {
        signupId: s.id,
        opportunityId: s.opportunity_id,
        role: roleByOpportunity.get(s.opportunity_id) ?? "",
        shiftLabel: shiftLabelByOpportunity.get(s.opportunity_id) ?? "",
        firstName: text("first_name"),
        lastName: text("last_name"),
        email: text("email"),
        phone: text("phone"),
        emergencyContact: text("emergency_contact"),
        emergencyPhone: text("emergency_phone"),
        profileFields,
        checkedInAt: s.checked_in_at,
      };
    });

    volunteerRoster.sort(
      (a, b) =>
        a.role.localeCompare(b.role) ||
        (a.lastName || a.firstName).localeCompare(b.lastName || b.firstName, undefined, {
          sensitivity: "base",
        }),
    );
  }

  return {
    event: event as AdminEventSummary,
    dietary: {
      collected: collectsDietary,
      notAnsweredCount: collectsDietary ? roster.filter((p) => !p.dietaryNotes?.trim()).length : 0,
    },
    waiver: { heading: waiverHeadingText, problem: waiverProblem },
    roster,
    waitlist,
    volunteerRoles,
    volunteerRoster,
  };
}
