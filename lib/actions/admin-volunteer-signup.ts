"use server";

import { createClient } from "@/lib/supabase/server";
import { requireEventManager } from "@/lib/admin/require-admin";
import { activeRsvpStatus } from "@/lib/volunteer-signups";
import {
  sendLeadVolunteerSignupChangeEmail,
  sendVolunteerSignupConfirmationEmail,
  type VolunteerShiftEmailContext,
} from "@/lib/email/send";

const OPPORTUNITY_COLUMNS =
  "id, event_id, role, description, what_to_bring, role_type_id, shift_start, shift_end, slots, slots_taken, cancelled_at";
const EVENT_COLUMNS =
  "id, name, chapter, waiver_state, starts_at, timezone, location, virtual_link, virtual_access_notes, lead_name, lead_phone, lead_email";

export type AdminAddVolunteerResult =
  | { ok: true; status: "confirmed" }
  | { ok: true; status: "capacity_exceeded" }
  /** `canOverride` is false for a chapter lead: only an admin may add
   * someone who isn't approved for the role (the database enforces it). */
  | { ok: true; status: "not_approved"; approvedForRole: boolean; canOverride: boolean }
  /** They're registered to attend this event ('confirmed' / 'waitlisted' /
   * 'offered'). Someone can't normally be both — adding them anyway is the
   * admin's call (overrideRsvp), and leaves the RSVP in place. */
  | { ok: true; status: "has_rsvp"; rsvpStatus: string }
  /** An instructor shift at an event that requires health history, and
   * they haven't passed a practical instruction check. Only an admin can
   * add them anyway, with a recorded reason (practicalCheckOverrideReason). */
  | { ok: true; status: "practical_check_required"; message: string; canOverride: boolean }
  | { ok: false; error: string };

/**
 * Admin "add a volunteer" — the walk-up equivalent for a volunteer shift.
 * Looks the person up by email (they must already have a profile — unlike
 * the participant walk-up flow, volunteers are invited, not created here)
 * and enforces the same approval eligibility as the participant signup
 * action, with an explicit override + confirmation step (mirroring the
 * walk-up form's capacity-exceeded confirm): call once with
 * overrideApproval/overrideRsvp/forceCapacity false, get back which
 * confirmation is needed, then call again with it set once the admin
 * confirms. Checks run in that order, each only until it's been overridden.
 */
export async function adminAddVolunteerSignupAction(input: {
  opportunityId: number;
  email: string;
  overrideApproval?: boolean;
  overrideRsvp?: boolean;
  forceCapacity?: boolean;
  /** Admin only: add past a missing practical check, with this reason
   * (recorded on the signup). */
  practicalCheckOverrideReason?: string;
}): Promise<AdminAddVolunteerResult> {
  const supabase = await createClient();

  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, error: "Email is required" };

  const { data: opportunity } = await supabase
    .from("volunteer_opportunities")
    .select(OPPORTUNITY_COLUMNS)
    .eq("id", input.opportunityId)
    .maybeSingle();
  if (!opportunity) return { ok: false, error: "This volunteer role no longer exists." };
  const adminCheck = await requireEventManager(supabase, opportunity.event_id as number);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  const isAdmin = adminCheck.actor.role === "admin";

  // The person and their approval for this role, via volunteer_for_shift —
  // so a chapter lead can add approved volunteers without reading the
  // volunteer registry itself.
  const { data: matches, error: lookupError } = await supabase.rpc("volunteer_for_shift", {
    p_opportunity_id: input.opportunityId,
    p_email: email,
  });
  if (lookupError) return { ok: false, error: lookupError.message };
  const profile = ((matches ?? []) as {
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    approved: boolean;
    approved_for_role: boolean;
  }[])[0];
  if (!profile) {
    return { ok: false, error: "No profile found for that email — they need an account first." };
  }
  const userId = profile.user_id;
  // admin_add_volunteer_signup's p_force would otherwise book a cancelled role.
  if (opportunity.cancelled_at) return { ok: false, error: "This volunteer role was cancelled." };

  const { data: event } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("id", opportunity.event_id as number)
    .maybeSingle();
  if (!event) return { ok: false, error: "Event not found" };

  // Only an admin can override approval (admin_add_volunteer_signup
  // refuses it for anyone else).
  if (!profile.approved_for_role && (!input.overrideApproval || !isAdmin)) {
    return {
      ok: true,
      status: "not_approved",
      approvedForRole: profile.approved,
      canOverride: isAdmin,
    };
  }

  if (!input.overrideRsvp) {
    const rsvpStatus = await activeRsvpStatus(supabase, userId, event.id as number);
    if (rsvpStatus) return { ok: true, status: "has_rsvp", rsvpStatus };
  }

  const overrideReason = isAdmin ? input.practicalCheckOverrideReason?.trim() : undefined;
  const { data, error } = overrideReason
    ? await supabase.rpc("admin_add_volunteer_signup_with_override", {
        p_opportunity_id: input.opportunityId,
        p_user_id: userId,
        p_force: input.forceCapacity ?? false,
        p_reason: overrideReason,
      })
    : await supabase.rpc("admin_add_volunteer_signup", {
        p_opportunity_id: input.opportunityId,
        p_user_id: userId,
        p_force: input.forceCapacity ?? false,
      });
  // The database's practical-check refusal (volunteer_signups_practical_check_guard).
  if (error?.hint === "practical_check_required") {
    return { ok: true, status: "practical_check_required", message: error.message, canOverride: isAdmin };
  }
  if (error) {
    console.error(`[admin-volunteer] opportunity ${input.opportunityId}: add failed:`, error);
    return { ok: false, error: error.message };
  }
  if (data === "capacity_exceeded") {
    return { ok: true, status: "capacity_exceeded" };
  }

  try {
    const ctx: VolunteerShiftEmailContext = {
      opportunityId: opportunity.id as number,
      role: opportunity.role as string,
      description: opportunity.description as string | null,
      whatToBring: opportunity.what_to_bring as string | null,
      shiftStart: opportunity.shift_start as string,
      shiftEnd: opportunity.shift_end as string,
      eventId: event.id as number,
      eventName: event.name as string,
      timezone: event.timezone as string,
      location: event.location as string | null,
      virtualLink: event.virtual_link as string | null,
      virtualAccessNotes: event.virtual_access_notes as string | null,
      leadName: event.lead_name as string | null,
      leadPhone: event.lead_phone as string | null,
      leadEmail: event.lead_email as string | null,
    };
    if (profile.email) {
      await sendVolunteerSignupConfirmationEmail({ ctx, toEmail: profile.email as string });
    }
    const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
    await sendLeadVolunteerSignupChangeEmail({
      ctx,
      volunteerName: name ? `${name} <${profile.email}>` : (profile.email as string),
      action: "signed_up",
    });
  } catch (err) {
    console.error(`[admin-volunteer] opportunity ${input.opportunityId}: confirmation email failed:`, err);
  }

  return { ok: true, status: "confirmed" };
}
