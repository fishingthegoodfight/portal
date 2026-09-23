"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  activeRsvpStatus,
  approvedRoleTypeIds,
  isApprovedVolunteer,
  isRoleEligible,
  type VolunteerOpportunity,
} from "@/lib/volunteer-signups";
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
  | { ok: true; status: "not_approved"; approvedForRole: boolean }
  /** They're registered to attend this event ('confirmed' / 'waitlisted' /
   * 'offered'). Someone can't normally be both — adding them anyway is the
   * admin's call (overrideRsvp), and leaves the RSVP in place. */
  | { ok: true; status: "has_rsvp"; rsvpStatus: string }
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
}): Promise<AdminAddVolunteerResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, error: "Email is required" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, email")
    .ilike("email", email)
    .maybeSingle();
  if (!profile) {
    return { ok: false, error: "No profile found for that email — they need an account first." };
  }
  const userId = profile.id as string;

  const { data: opportunity } = await supabase
    .from("volunteer_opportunities")
    .select(OPPORTUNITY_COLUMNS)
    .eq("id", input.opportunityId)
    .maybeSingle();
  if (!opportunity) return { ok: false, error: "This volunteer role no longer exists." };
  // admin_add_volunteer_signup's p_force would otherwise book a cancelled role.
  if (opportunity.cancelled_at) return { ok: false, error: "This volunteer role was cancelled." };

  const { data: event } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("id", opportunity.event_id as number)
    .maybeSingle();
  if (!event) return { ok: false, error: "Event not found" };

  if (!input.overrideApproval) {
    const approved = await isApprovedVolunteer(supabase, userId);
    const approvedTypes = approved ? await approvedRoleTypeIds(supabase, userId) : new Set<number>();
    const roleOk = approved && isRoleEligible(opportunity as VolunteerOpportunity, approvedTypes);
    if (!roleOk) {
      return { ok: true, status: "not_approved", approvedForRole: approved };
    }
  }

  if (!input.overrideRsvp) {
    const rsvpStatus = await activeRsvpStatus(supabase, userId, event.id as number);
    if (rsvpStatus) return { ok: true, status: "has_rsvp", rsvpStatus };
  }

  const { data, error } = await supabase.rpc("admin_add_volunteer_signup", {
    p_opportunity_id: input.opportunityId,
    p_user_id: userId,
    p_force: input.forceCapacity ?? false,
  });
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
