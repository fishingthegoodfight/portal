import type { SupabaseClient } from "@supabase/supabase-js";

import { waiverInfoForVolunteerAtEvent, type WaiverEvent, type WaiverInfo } from "@/lib/waivers";

/**
 * Volunteer signups for a specific event's roles (table `volunteer_signups`,
 * see the 2026-09-22 "Volunteer signups for events" schema-changes.sql
 * entry) — distinct from RSVPing to attend and from volunteer registration
 * (the volunteers/volunteer_role_approvals catalog). No waitlist or shift
 * swaps: a full shift is just full.
 */

export type VolunteerOpportunity = {
  id: number;
  event_id: number;
  role: string;
  description: string | null;
  what_to_bring: string | null;
  role_type_id: number | null;
  shift_start: string;
  shift_end: string;
  slots: number;
  slots_taken: number;
  /** Set when an admin cancelled the role — never offered for signup. */
  cancelled_at?: string | null;
};

/** volunteers.status === 'approved' — the base gate for every eligibility
 * check below. */
export async function isApprovedVolunteer(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("volunteers")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.status === "approved";
}

/** role_type_ids this volunteer has an active (unrevoked) approval for. */
export async function approvedRoleTypeIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<Set<number>> {
  const { data } = await supabase
    .from("volunteer_role_approvals")
    .select("role_type_id")
    .eq("volunteer_id", userId)
    .is("revoked_at", null);
  return new Set((data ?? []).map((r) => r.role_type_id as number));
}

/** Whether an approved volunteer may sign up for this specific opportunity:
 * a role with no role_type_id (the wizard's "Custom / other") is open to any
 * approved volunteer; otherwise they need an active approval for that
 * role_type_id specifically. Does NOT check volunteers.status itself — call
 * isApprovedVolunteer first. */
export function isRoleEligible(
  opportunity: Pick<VolunteerOpportunity, "role_type_id">,
  approvedRoleTypes: Set<number>,
): boolean {
  return opportunity.role_type_id == null || approvedRoleTypes.has(opportunity.role_type_id);
}

/** The opportunities at an event this approved volunteer could sign up for,
 * by role eligibility alone (the waiver is a separate, person-wide gate —
 * see checkVolunteerSignupEligibility). */
export function eligibleOpportunities(
  opportunities: VolunteerOpportunity[],
  approvedRoleTypes: Set<number>,
): VolunteerOpportunity[] {
  return opportunities.filter((o) => isRoleEligible(o, approvedRoleTypes));
}

export type SignupEligibility =
  | { ok: true }
  | { ok: false; reason: "not_approved"; message: string }
  | { ok: false; reason: "role_not_approved"; message: string }
  | { ok: false; reason: "waiver_unsigned"; message: string; waiverInfo: WaiverInfo };

/**
 * Full server-side eligibility check for one signup attempt — the
 * authoritative check the signup action runs before calling
 * sign_up_for_volunteer_shift, independent of what the UI already filtered
 * to. Mirrors the RSVP waiver backstop in confirmRsvpAction (lib/actions/rsvp.ts).
 */
export async function checkVolunteerSignupEligibility(
  supabase: SupabaseClient,
  userId: string,
  opportunity: Pick<VolunteerOpportunity, "role_type_id">,
  event: WaiverEvent,
): Promise<SignupEligibility> {
  if (!(await isApprovedVolunteer(supabase, userId))) {
    return {
      ok: false,
      reason: "not_approved",
      message: "Volunteering requires an approved volunteer registration.",
    };
  }

  if (opportunity.role_type_id != null) {
    const approved = await approvedRoleTypeIds(supabase, userId);
    if (!approved.has(opportunity.role_type_id)) {
      return {
        ok: false,
        reason: "role_not_approved",
        message: "You're not approved for this role yet.",
      };
    }
  }

  const waiverInfo = await waiverInfoForVolunteerAtEvent(supabase, event, userId);
  if (waiverInfo.status !== "signed") {
    return {
      ok: false,
      reason: "waiver_unsigned",
      message:
        waiverInfo.status === "unavailable"
          ? waiverInfo.message
          : "Sign the volunteer waiver to continue.",
      waiverInfo,
    };
  }

  return { ok: true };
}

/** What sign_up_for_volunteer_shift / switch_rsvp_to_volunteer return when
 * the database's own eligibility gate (volunteer_signup_blocker, the SQL
 * mirror of checkVolunteerSignupEligibility) refuses — normally caught by the
 * check above first, so these only show if something changed in between. */
export const SIGNUP_BLOCKER_MESSAGES: Record<string, string> = {
  not_found: "This volunteer role no longer exists.",
  not_approved: "Volunteering requires an approved volunteer registration.",
  role_not_approved: "You're not approved for this role yet.",
  waiver_unsigned: "Sign the volunteer waiver to continue.",
  registration_incomplete: "Please complete the registration questions first.",
};

/** The caller's ACTIVE RSVP status at an event ('confirmed' | 'waitlisted' |
 * 'offered'), or null. Someone with one can't also volunteer there — see the
 * 2026-09-23 schema-changes.sql entry. Filtered by user_id explicitly: admins
 * can read every RSVP. */
export async function activeRsvpStatus(
  supabase: SupabaseClient,
  userId: string,
  eventId: number,
): Promise<string | null> {
  const { data } = await supabase
    .from("rsvps")
    .select("status")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .in("status", ["confirmed", "waitlisted", "offered"])
    .maybeSingle();
  return (data?.status as string | undefined) ?? null;
}

export type ConfirmedShift = {
  opportunityId: number;
  role: string;
  shiftStart: string;
  shiftEnd: string;
};

/** A person's confirmed volunteer shifts at one event — someone with any
 * can't also RSVP there. Filtered by user_id explicitly, same reason as
 * activeRsvpStatus. */
export async function confirmedShiftsAtEvent(
  supabase: SupabaseClient,
  userId: string,
  eventId: number,
): Promise<ConfirmedShift[]> {
  const { data } = await supabase
    .from("volunteer_signups")
    .select("opportunity:volunteer_opportunities!inner(id, role, shift_start, shift_end, event_id)")
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .eq("opportunity.event_id", eventId);
  return ((data ?? []) as unknown as {
    opportunity: { id: number; role: string; shift_start: string; shift_end: string } | null;
  }[])
    .filter((row) => row.opportunity)
    .map((row) => ({
      opportunityId: row.opportunity!.id,
      role: row.opportunity!.role,
      shiftStart: row.opportunity!.shift_start,
      shiftEnd: row.opportunity!.shift_end,
    }))
    .sort((a, b) => a.shiftStart.localeCompare(b.shiftStart));
}

export type OpenShift = {
  opportunityId: number;
  role: string;
  shiftStart: string;
  shiftEnd: string;
  spotsRemaining: number;
  event: { id: number; name: string; timezone: string; starts_at: string; chapter: string | null };
};

/**
 * Shifts this approved volunteer could sign up for right now: on a published,
 * scheduled event that hasn't started, a role that isn't cancelled, has an
 * open slot, and that they're role-eligible for (see isRoleEligible), and
 * that they aren't already signed up for. Backs the events list's "Needs
 * volunteers" filter/badge and the volunteer home page's "Open shifts" list.
 * Returns [] for anyone who isn't an approved volunteer. `eventIds` narrows
 * it to those events. Sorted by shift start.
 */
export async function loadOpenShiftsForVolunteer(
  supabase: SupabaseClient,
  userId: string,
  options: { eventIds?: number[] } = {},
): Promise<OpenShift[]> {
  if (options.eventIds?.length === 0) return [];
  if (!(await isApprovedVolunteer(supabase, userId))) return [];

  let query = supabase
    .from("volunteer_opportunities")
    .select(
      "id, role, role_type_id, shift_start, shift_end, slots, slots_taken, event:events!inner(id, name, timezone, starts_at, chapter, is_published, status)",
    )
    .is("cancelled_at", null)
    .eq("event.is_published", true)
    .eq("event.status", "scheduled")
    .gte("event.starts_at", new Date().toISOString());
  if (options.eventIds) query = query.in("event_id", options.eventIds);

  const [{ data: rows }, approvedTypes, { data: mine }] = await Promise.all([
    query,
    approvedRoleTypeIds(supabase, userId),
    supabase
      .from("volunteer_signups")
      .select("opportunity_id")
      .eq("user_id", userId)
      .eq("status", "confirmed"),
  ]);
  const signedUp = new Set((mine ?? []).map((s) => s.opportunity_id as number));

  return ((rows ?? []) as unknown as (VolunteerOpportunity & {
    event: OpenShift["event"] | null;
  })[])
    .filter(
      (o) =>
        o.event &&
        o.slots_taken < o.slots &&
        !signedUp.has(o.id) &&
        isRoleEligible(o, approvedTypes),
    )
    .map((o) => ({
      opportunityId: o.id,
      role: o.role,
      shiftStart: o.shift_start,
      shiftEnd: o.shift_end,
      spotsRemaining: o.slots - o.slots_taken,
      event: o.event!,
    }))
    .sort((a, b) => a.shiftStart.localeCompare(b.shiftStart));
}
