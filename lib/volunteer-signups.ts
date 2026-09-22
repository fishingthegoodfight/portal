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
