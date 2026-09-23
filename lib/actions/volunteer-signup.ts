"use server";

import { createClient } from "@/lib/supabase/server";
import {
  activeRsvpStatus,
  checkVolunteerSignupEligibility,
  SIGNUP_BLOCKER_MESSAGES,
  type VolunteerOpportunity,
} from "@/lib/volunteer-signups";
import {
  sendLeadParticipantCancelledEmail,
  sendLeadVolunteerSignupChangeEmail,
  sendSwitchedToVolunteeringEmail,
  sendVolunteerCancellationEmail,
  sendVolunteerSignupConfirmationEmail,
  type RsvpEmailEvent,
  type VolunteerShiftEmailContext,
} from "@/lib/email/send";
import { emailWaitlistOffers, offeredLabels, type OfferedSpot } from "@/lib/waitlist";
import {
  collectSectionUpdates,
  columnValuesFromProfile,
  firstIncompleteSection,
  isSectionComplete,
  profileValueFromColumn,
  REGISTRATION_SECTIONS,
  sectionsForEvent,
} from "@/lib/registration-sections";
import type { WaiverInfo } from "@/lib/waivers";

export type VolunteerSignupResult =
  | { ok: true; status: "confirmed" }
  /** They hold an active RSVP at this event — offer "Switch to volunteering"
   * and call again with switchFromRsvp once they confirm. Nothing was saved. */
  | { ok: false; needsSwitch: true; rsvpStatus: string; error: string }
  | { ok: false; error: string; waiverInfo?: WaiverInfo };

export type VolunteerCancelResult = { ok: true } | { ok: false; error: string };

const OPPORTUNITY_COLUMNS =
  "id, event_id, role, description, what_to_bring, role_type_id, shift_start, shift_end, slots, slots_taken, cancelled_at";
// A superset of RsvpEmailEvent's columns: the switch email also cancels the
// event's own calendar entry, and the lead gets the participant-cancelled note.
const EVENT_COLUMNS =
  "id, name, chapter, waiver_state, starts_at, ends_at, timezone, location, virtual_link, virtual_access_notes, lead_name, lead_phone, lead_email, custom_email_note, occurrence_note, ics_sequence, registration_sections";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type SignupEvent = RsvpEmailEvent & {
  chapter: string | null;
  waiver_state: string | null;
  registration_sections: string[] | null;
};

async function loadOpportunityAndEvent(
  supabase: SupabaseServerClient,
  opportunityId: number,
): Promise<{ opportunity: VolunteerOpportunity; event: SignupEvent } | null> {
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

  return { opportunity: opportunity as VolunteerOpportunity, event: event as SignupEvent };
}

function buildEmailContext(
  opportunity: VolunteerOpportunity,
  event: SignupEvent,
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
    leadName: event.lead_name,
    leadPhone: event.lead_phone,
    leadEmail: event.lead_email,
  };
}

/**
 * The "Sign up" button on the event page's Volunteer section. Re-checks
 * eligibility server-side (the UI already filtered to it, and
 * sign_up_for_volunteer_shift re-checks it again in the database), collects
 * the event's registration sections exactly like an RSVP does, then claims
 * the shift atomically. A full shift returns an error rather than offering
 * signup — no volunteer waitlist yet.
 *
 * Someone registered to attend the event can't also volunteer at it: they
 * get `needsSwitch` back, and once they confirm, a second call with
 * `switchFromRsvp` cancels the RSVP and signs them up in one transaction
 * (switch_rsvp_to_volunteer), with one email describing where they stand.
 */
export async function signUpForVolunteerShiftAction(
  opportunityId: number,
  options: {
    /** Answers to the event's registration sections, keyed by profile
     * column — only sections not already complete on file are read. */
    sections?: Record<string, string>;
    switchFromRsvp?: boolean;
  } = {},
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

  const rsvpStatus = await activeRsvpStatus(supabase, userId, event.id);
  if (rsvpStatus && !options.switchFromRsvp) {
    return {
      ok: false,
      needsSwitch: true,
      rsvpStatus,
      error: "You're registered to attend this event — you can attend or volunteer, not both.",
    };
  }

  // The event's registration sections (dietary, sizing, emergency contact, …)
  // — the waiver is the volunteer one, handled above. Same validation and
  // saving rule as the RSVP form and the walk-up action: a section complete
  // on file is left alone; anything newly answered is saved to the profile.
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  const onFile: Record<string, string> = {};
  for (const section of REGISTRATION_SECTIONS) {
    for (const field of section.fields) {
      onFile[field.key] = profileValueFromColumn(field, profile?.[field.key]);
    }
  }
  const eventSections = sectionsForEvent(event.registration_sections).filter(
    (section) => section.kind !== "waiver",
  );
  const values: Record<string, string> = { ...onFile };
  for (const section of eventSections) {
    if (!section.alwaysEditable && isSectionComplete(section, onFile)) continue;
    for (const field of section.fields) {
      values[field.key] = options.sections?.[field.key] ?? onFile[field.key] ?? "";
    }
  }
  const incomplete = firstIncompleteSection(eventSections, values);
  if (incomplete) return { ok: false, error: `Complete "${incomplete.title}" first.` };
  const updates = collectSectionUpdates(eventSections, onFile, values);
  if (Object.keys(updates).length > 0) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update(columnValuesFromProfile(updates))
      .eq("id", userId);
    if (profileError) {
      console.error(`[volunteer-signup] opportunity ${opportunityId}: saving answers failed:`, profileError);
      return { ok: false, error: profileError.message };
    }
  }

  const switching = Boolean(rsvpStatus && options.switchFromRsvp);
  let status: string;
  let previousRsvpStatus: string | null = null;
  let offered: OfferedSpot[] = [];
  if (switching) {
    const { data, error } = await supabase.rpc("switch_rsvp_to_volunteer", {
      p_opportunity_id: opportunityId,
    });
    if (error) {
      console.error(`[volunteer-signup] opportunity ${opportunityId}: switch failed:`, error);
      return { ok: false, error: error.message };
    }
    const outcome = data as {
      status: string;
      previous_status?: string | null;
      offered?: OfferedSpot[];
    } | null;
    status = outcome?.status ?? "";
    previousRsvpStatus = outcome?.previous_status ?? null;
    offered = outcome?.offered ?? [];
  } else {
    const { data, error } = await supabase.rpc("sign_up_for_volunteer_shift", {
      p_opportunity_id: opportunityId,
    });
    if (error) {
      console.error(`[volunteer-signup] opportunity ${opportunityId}: signup failed:`, error);
      return { ok: false, error: error.message };
    }
    status = typeof data === "string" ? data : "";
  }

  if (status === "full") {
    return {
      ok: false,
      error: switching
        ? "This shift just filled up — your RSVP is unchanged."
        : "This shift is full.",
    };
  }
  if (status === "has_rsvp") {
    // Registered to attend in another tab since the check above.
    const current = (await activeRsvpStatus(supabase, userId, event.id)) ?? "confirmed";
    return {
      ok: false,
      needsSwitch: true,
      rsvpStatus: current,
      error: "You're registered to attend this event — you can attend or volunteer, not both.",
    };
  }
  if (status !== "confirmed") {
    return { ok: false, error: SIGNUP_BLOCKER_MESSAGES[status] ?? "Couldn't sign you up — try again." };
  }

  const ctx = buildEmailContext(opportunity, event);
  let volunteerLabel: string | null = null;
  try {
    const { data: contact } = await supabase
      .from("profiles")
      .select("email, first_name, last_name")
      .eq("id", userId)
      .maybeSingle();
    if (contact?.email) {
      const email = contact.email as string;
      const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
      volunteerLabel = name ? `${name} <${email}>` : email;
      // A switch gets one email saying where they now stand — not the usual
      // "RSVP cancelled" plus a separate volunteer confirmation.
      if (switching) {
        await sendSwitchedToVolunteeringEmail({ ctx, event, toEmail: email, previousRsvpStatus });
      } else {
        await sendVolunteerSignupConfirmationEmail({ ctx, toEmail: email });
      }
      await sendLeadVolunteerSignupChangeEmail({ ctx, volunteerName: volunteerLabel, action: "signed_up" });
    }
  } catch (err) {
    console.error(`[volunteer-signup] opportunity ${opportunityId}: confirmation email failed:`, err);
  }

  if (switching) {
    // The freed spot (or declined offer) went to the waitlist inside
    // cancel_rsvp — tell whoever got it, and the lead, same as a normal cancel.
    await emailWaitlistOffers(event.id, offered);
    if (previousRsvpStatus === "confirmed" && volunteerLabel) {
      try {
        await sendLeadParticipantCancelledEmail({
          event,
          cancelledBy: `${volunteerLabel} (switched to volunteering)`,
          offeredTo: await offeredLabels(offered),
        });
      } catch (err) {
        console.error(`[volunteer-signup] event ${event.id}: lead cancellation notice failed:`, err);
      }
    }
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
