"use server";

import { createClient } from "@/lib/supabase/server";
import { checkVolunteerSignupEligibility, type VolunteerOpportunity } from "@/lib/volunteer-signups";
import {
  sendLeadVolunteerSignupChangeEmail,
  sendVolunteerCancellationEmail,
  sendVolunteerSignupConfirmationEmail,
  type VolunteerShiftEmailContext,
} from "@/lib/email/send";
import type { WaiverInfo } from "@/lib/waivers";

export type VolunteerSignupResult =
  | { ok: true; status: "confirmed" }
  | { ok: false; error: string; waiverInfo?: WaiverInfo };

export type VolunteerCancelResult = { ok: true } | { ok: false; error: string };

const OPPORTUNITY_COLUMNS =
  "id, event_id, role, description, what_to_bring, role_type_id, shift_start, shift_end, slots, slots_taken, cancelled_at";
const EVENT_COLUMNS =
  "id, name, chapter, waiver_state, starts_at, timezone, location, virtual_link, virtual_access_notes, lead_email";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function loadOpportunityAndEvent(
  supabase: SupabaseServerClient,
  opportunityId: number,
): Promise<{
  opportunity: VolunteerOpportunity;
  event: {
    id: number;
    name: string;
    chapter: string | null;
    waiver_state: string | null;
    starts_at: string;
    timezone: string;
    location: string | null;
    virtual_link: string | null;
    virtual_access_notes: string | null;
    lead_email: string | null;
  };
} | null> {
  const { data: opportunity } = await supabase
    .from("volunteer_opportunities")
    .select(OPPORTUNITY_COLUMNS)
    .eq("id", opportunityId)
    .maybeSingle();
  if (!opportunity) return null;

  const { data: event } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("id", opportunity.event_id as number)
    .maybeSingle();
  if (!event) return null;

  return { opportunity: opportunity as VolunteerOpportunity, event };
}

function buildEmailContext(
  opportunity: VolunteerOpportunity,
  event: NonNullable<Awaited<ReturnType<typeof loadOpportunityAndEvent>>>["event"],
): VolunteerShiftEmailContext {
  return {
    opportunityId: opportunity.id,
    role: opportunity.role,
    description: opportunity.description,
    whatToBring: opportunity.what_to_bring,
    shiftStart: opportunity.shift_start,
    shiftEnd: opportunity.shift_end,
    eventId: event.id,
    eventName: event.name,
    timezone: event.timezone,
    location: event.location,
    virtualLink: event.virtual_link,
    virtualAccessNotes: event.virtual_access_notes,
    leadEmail: event.lead_email,
  };
}

/**
 * The "Sign up" button on the event page's Volunteer section. Re-checks
 * eligibility server-side (the UI already filtered to it, but a hand-rolled
 * request shouldn't be able to sign up without it — same reasoning as the
 * waiver backstop in confirmRsvpAction, lib/actions/rsvp.ts), then claims
 * the shift atomically via sign_up_for_volunteer_shift. A full shift returns
 * an error rather than offering signup — no volunteer waitlist yet.
 */
export async function signUpForVolunteerShiftAction(
  opportunityId: number,
): Promise<VolunteerSignupResult> {
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) return { ok: false, error: "Not authenticated" };
  const userId = claims.claims.sub as string;

  const loaded = await loadOpportunityAndEvent(supabase, opportunityId);
  if (!loaded) return { ok: false, error: "This volunteer role no longer exists." };
  const { opportunity, event } = loaded;
  // try_claim_volunteer_slot refuses it too, but would read as "full".
  if (opportunity.cancelled_at) return { ok: false, error: "This volunteer role was cancelled." };

  const eligibility = await checkVolunteerSignupEligibility(supabase, userId, opportunity, event);
  if (!eligibility.ok) {
    return {
      ok: false,
      error: eligibility.message,
      waiverInfo: eligibility.reason === "waiver_unsigned" ? eligibility.waiverInfo : undefined,
    };
  }

  const { data, error } = await supabase.rpc("sign_up_for_volunteer_shift", {
    p_opportunity_id: opportunityId,
  });
  if (error) {
    console.error(`[volunteer-signup] opportunity ${opportunityId}: signup failed:`, error);
    return { ok: false, error: error.message };
  }
  if (data === "full") {
    return { ok: false, error: "This shift is full." };
  }

  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("email, first_name, last_name")
      .eq("id", userId)
      .maybeSingle();
    if (profile?.email) {
      const ctx = buildEmailContext(opportunity, event);
      await sendVolunteerSignupConfirmationEmail({ ctx, toEmail: profile.email as string });
      const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
      await sendLeadVolunteerSignupChangeEmail({
        ctx,
        volunteerName: name ? `${name} <${profile.email}>` : (profile.email as string),
        action: "signed_up",
      });
    }
  } catch (err) {
    console.error(`[volunteer-signup] opportunity ${opportunityId}: confirmation email failed:`, err);
  }

  return { ok: true, status: "confirmed" };
}

/** The "Cancel" button — frees the shift back for someone else. */
export async function cancelVolunteerSignupAction(
  opportunityId: number,
): Promise<VolunteerCancelResult> {
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) return { ok: false, error: "Not authenticated" };
  const userId = claims.claims.sub as string;

  // Loaded before cancelling for the email context — cancel_volunteer_signup
  // only touches volunteer_signups/volunteer_opportunities, not this data.
  const loaded = await loadOpportunityAndEvent(supabase, opportunityId);

  const { data, error } = await supabase.rpc("cancel_volunteer_signup", {
    p_opportunity_id: opportunityId,
  });
  if (error) {
    console.error(`[volunteer-signup] opportunity ${opportunityId}: cancel failed:`, error);
    return { ok: false, error: error.message };
  }
  if (data !== "cancelled") {
    return { ok: false, error: "You don't have a volunteer signup for this shift to cancel." };
  }

  if (loaded) {
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("email, first_name, last_name")
        .eq("id", userId)
        .maybeSingle();
      if (profile?.email) {
        const ctx = buildEmailContext(loaded.opportunity, loaded.event);
        await sendVolunteerCancellationEmail({ ctx, toEmail: profile.email as string });
        const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
        await sendLeadVolunteerSignupChangeEmail({
          ctx,
          volunteerName: name ? `${name} <${profile.email}>` : (profile.email as string),
          action: "cancelled",
        });
      }
    } catch (err) {
      console.error(`[volunteer-signup] opportunity ${opportunityId}: cancellation email failed:`, err);
    }
  }

  return { ok: true };
}
