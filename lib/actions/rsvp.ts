"use server";

import { createClient } from "@/lib/supabase/server";
import {
  sendLeadParticipantCancelledEmail,
  sendLeadVolunteerSignupChangeEmail,
  sendRsvpCancellationEmail,
  sendRsvpConfirmationEmail,
  sendSwitchedToAttendingEmail,
  type RsvpEmailEvent,
  type VolunteerShiftEmailContext,
} from "@/lib/email/send";
import { formatEventDateRange } from "@/lib/format-date";
import { waiverInfoForUser } from "@/lib/waivers";
import { emailWaitlistOffers, offeredLabels, type OfferedSpot } from "@/lib/waitlist";
import { confirmedShiftsAtEvent, type ConfirmedShift } from "@/lib/volunteer-signups";

export type RsvpActionResult =
  | { ok: true; status: string }
  /** confirmRsvpAction only: they have a confirmed volunteer shift at this
   * event — offer "Switch to attending" and call again with
   * switchFromVolunteering once they confirm. Nothing was saved. */
  | { ok: false; error: string; needsSwitch: true; shifts: string[] }
  | { ok: false; error: string };

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const EVENT_EMAIL_COLUMNS =
  "id, name, starts_at, ends_at, timezone, location, lead_name, lead_phone, lead_email, custom_email_note, occurrence_note, virtual_link, virtual_access_notes, ics_sequence";

async function loadEmailContext(
  supabase: SupabaseServerClient,
  eventId: number,
  userId: string,
): Promise<{ event: RsvpEmailEvent; toEmail: string; label: string } | null> {
  const [{ data: event }, { data: profile }] = await Promise.all([
    supabase.from("events").select(EVENT_EMAIL_COLUMNS).eq("id", eventId).maybeSingle(),
    supabase.from("profiles").select("email, first_name, last_name").eq("id", userId).maybeSingle(),
  ]);
  if (!event || !profile?.email) return null;
  const email = profile.email as string;
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
  return {
    event: event as RsvpEmailEvent,
    toEmail: email,
    label: name ? `${name} <${email}>` : email,
  };
}

/** "Role, Sat, Oct 3, 9:00 AM – 12:00 PM" for each shift, in the event's zone. */
function shiftLabels(shifts: ConfirmedShift[], timeZone: string): string[] {
  return shifts.map((s) => `${s.role}, ${formatEventDateRange(s.shiftStart, s.shiftEnd, timeZone)}`);
}

/** Why rsvp_to_event (or the switch built on it) refused, writing nothing —
 * it re-checks everything the RSVP form and this action already check (see
 * the 2026-09-23 "Every user-callable function" schema-changes.sql entry),
 * so these normally only show if something changed in between. */
const RSVP_REFUSALS: Record<string, string> = {
  unavailable: "This event isn't open for RSVPs.",
  waiver_unsigned: "Please read and sign the waiver before RSVPing.",
  registration_incomplete: "Please complete the registration questions before RSVPing.",
};

function needsSwitchResult(shifts: string[]): RsvpActionResult {
  return {
    ok: false,
    needsSwitch: true,
    shifts,
    error: "You're signed up to volunteer at this event — you can attend or volunteer, not both.",
  };
}

/**
 * Confirms (or updates) the caller's RSVP via the rsvp_to_event RPC, then
 * sends the confirmation email. A failed database write fails the action; a
 * failed email does not — it's logged and swallowed so the RSVP still
 * stands.
 *
 * Someone with a confirmed volunteer shift at the event can't also attend:
 * they get `needsSwitch` back, and once they confirm, a second call with
 * `switchFromVolunteering` cancels their shift(s) and RSVPs them in one
 * transaction (switch_volunteer_to_rsvp) — only if a spot is actually open;
 * a switch never trades a shift for a waitlist place.
 */
export async function confirmRsvpAction(
  eventId: number,
  dietaryNotes: string | null,
  options: { switchFromVolunteering?: boolean } = {},
): Promise<RsvpActionResult> {
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) {
    return { ok: false, error: "Not authenticated" };
  }
  const userId = claims.claims.sub as string;

  // Server-side backstop for the waiver: the form gates on it, but a
  // hand-rolled request shouldn't be able to RSVP without one.
  const { data: waiverEvent } = await supabase
    .from("events")
    .select("chapter, waiver_state, starts_at, timezone")
    .eq("id", eventId)
    .maybeSingle();
  if (waiverEvent) {
    const waiver = await waiverInfoForUser(supabase, waiverEvent, userId);
    if (waiver.status !== "signed") {
      return {
        ok: false,
        error:
          waiver.status === "unavailable"
            ? waiver.message
            : "Please read and sign the waiver before RSVPing.",
      };
    }
  }

  const { data: existingRsvp } = await supabase
    .from("rsvps")
    .select("status")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .in("status", ["confirmed", "waitlisted", "offered"])
    .maybeSingle();
  const shifts = existingRsvp ? [] : await confirmedShiftsAtEvent(supabase, userId, eventId);
  if (shifts.length > 0) {
    if (!options.switchFromVolunteering) {
      return needsSwitchResult(shiftLabels(shifts, waiverEvent?.timezone ?? "America/Denver"));
    }
    return switchToAttending(supabase, eventId, userId, dietaryNotes, shifts);
  }

  const { data, error } = await supabase.rpc("rsvp_to_event", {
    p_event_id: eventId,
    p_dietary: dietaryNotes,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  if (data === "is_volunteer") {
    // Signed up to volunteer in another tab since the check above.
    const latest = await confirmedShiftsAtEvent(supabase, userId, eventId);
    return needsSwitchResult(shiftLabels(latest, waiverEvent?.timezone ?? "America/Denver"));
  }
  if (typeof data === "string" && RSVP_REFUSALS[data]) {
    return { ok: false, error: RSVP_REFUSALS[data] };
  }

  const status = typeof data === "string" && data ? data : "confirmed";

  try {
    const context = await loadEmailContext(supabase, eventId, userId);
    if (context) {
      await sendRsvpConfirmationEmail({
        event: context.event,
        toEmail: context.toEmail,
        status: status === "waitlisted" ? "waitlisted" : "confirmed",
      });
    }
  } catch (err) {
    console.error(`Failed to send RSVP confirmation email for event ${eventId}:`, err);
  }

  return { ok: true, status };
}

/** The confirmed second step of "Switch to attending" — see confirmRsvpAction. */
async function switchToAttending(
  supabase: SupabaseServerClient,
  eventId: number,
  userId: string,
  dietaryNotes: string | null,
  shifts: ConfirmedShift[],
): Promise<RsvpActionResult> {
  // Loaded before the switch for the emails; the shifts' role details too.
  const { data: roleRows } = await supabase
    .from("volunteer_opportunities")
    .select("id, role, description, what_to_bring, shift_start, shift_end")
    .in(
      "id",
      shifts.map((s) => s.opportunityId),
    );

  const { data, error } = await supabase.rpc("switch_volunteer_to_rsvp", {
    p_event_id: eventId,
    p_dietary: dietaryNotes,
  });
  if (error) {
    console.error(`[rsvp] event ${eventId}: switch_volunteer_to_rsvp failed:`, error);
    return { ok: false, error: error.message };
  }
  const outcome = data as { status: string; cancelled_opportunity_ids: number[] } | null;
  if (outcome && RSVP_REFUSALS[outcome.status]) {
    return { ok: false, error: `${RSVP_REFUSALS[outcome.status]} Your volunteer shift is unchanged.` };
  }
  if (outcome?.status !== "confirmed") {
    return {
      ok: false,
      error:
        "This event is full, so switching would only put you on the waitlist — your volunteer shift is unchanged. Cancel your shift first if you'd rather join the waitlist.",
    };
  }

  try {
    const context = await loadEmailContext(supabase, eventId, userId);
    if (context) {
      const cancelledIds = new Set(outcome.cancelled_opportunity_ids ?? []);
      const cancelledShifts: VolunteerShiftEmailContext[] = (roleRows ?? [])
        .filter((r) => cancelledIds.has(r.id as number))
        .map((r) => ({
          opportunityId: r.id as number,
          role: r.role as string,
          description: r.description as string | null,
          whatToBring: r.what_to_bring as string | null,
          shiftStart: r.shift_start as string,
          shiftEnd: r.shift_end as string,
          eventId,
          eventName: context.event.name,
          timezone: context.event.timezone,
          location: context.event.location,
          virtualLink: context.event.virtual_link,
          virtualAccessNotes: context.event.virtual_access_notes,
          leadName: context.event.lead_name,
          leadPhone: context.event.lead_phone,
          leadEmail: context.event.lead_email,
        }));
      await sendSwitchedToAttendingEmail({
        event: context.event,
        toEmail: context.toEmail,
        cancelledShifts,
      });
      for (const ctx of cancelledShifts) {
        await sendLeadVolunteerSignupChangeEmail({
          ctx,
          volunteerName: `${context.label} (switched to attending)`,
          action: "cancelled",
        });
      }
    }
  } catch (err) {
    console.error(`[rsvp] event ${eventId}: switch email failed:`, err);
  }

  return { ok: true, status: "confirmed" };
}

/**
 * "Update my registration": saves answers for an RSVP the caller already
 * holds (dietary note on the RSVP row; the profile part is saved by the form
 * the same way a fresh RSVP does). Goes through update_rsvp_answers, which can
 * only touch an existing active RSVP — it never creates one, changes status,
 * or takes capacity — and sends no confirmation email. `updateDietary` says
 * whether this event collects the dietary answer; if not, the existing note is
 * left alone.
 */
export async function updateRegistrationAction(
  eventId: number,
  dietaryNotes: string | null,
  updateDietary: boolean,
): Promise<RsvpActionResult> {
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) {
    return { ok: false, error: "Not authenticated" };
  }

  const { data, error } = await supabase.rpc("update_rsvp_answers", {
    p_event_id: eventId,
    p_dietary: dietaryNotes,
    p_update_dietary: updateDietary,
  });
  if (error) {
    console.error(`[update-registration] event ${eventId}: update_rsvp_answers failed:`, error);
    return { ok: false, error: error.message };
  }
  if (typeof data !== "string" || !data) {
    return { ok: false, error: "You don't have an active RSVP for this event to update." };
  }
  return { ok: true, status: data };
}

/**
 * Cancels the caller's RSVP via the cancel_rsvp RPC — which, in the same
 * transaction, offers a freed confirmed spot (or a declined offer) to the
 * next person on the waitlist — then sends the emails: the cancellation to
 * the caller, the "a spot opened" offer to whoever was offered it, and (for a
 * confirmed RSVP) a heads-up to the event lead. Same failure handling as
 * confirmRsvpAction: a database error fails the action, an email error only
 * gets logged.
 */
export async function cancelRsvpAction(eventId: number): Promise<RsvpActionResult> {
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) {
    return { ok: false, error: "Not authenticated" };
  }
  const userId = claims.claims.sub as string;

  // Loaded before the delete, though it wouldn't matter either way —
  // cancel_rsvp only removes the rsvps row, not the event or profile.
  const context = await loadEmailContext(supabase, eventId, userId);

  const { data, error } = await supabase.rpc("cancel_rsvp", { p_event_id: eventId });
  if (error) {
    console.error(`[cancel-rsvp] event ${eventId}: cancel_rsvp failed:`, error);
    return { ok: false, error: error.message };
  }
  const outcome = data as { previous_status: string | null; offered: OfferedSpot[] } | null;
  // Nothing was deleted (no RSVP of yours on this event, or an unexpected
  // response): say so instead of reporting a cancellation that didn't happen.
  if (!outcome || !outcome.previous_status) {
    console.error(`[cancel-rsvp] event ${eventId}: cancel_rsvp removed nothing; response:`, data);
    return { ok: false, error: "You don't have an RSVP for this event to cancel." };
  }

  try {
    if (context && outcome.previous_status) {
      await sendRsvpCancellationEmail({ event: context.event, toEmail: context.toEmail });
    }
  } catch (err) {
    console.error(`Failed to send RSVP cancellation email for event ${eventId}:`, err);
  }

  await emailWaitlistOffers(eventId, outcome.offered);

  if (context && outcome.previous_status === "confirmed") {
    try {
      await sendLeadParticipantCancelledEmail({
        event: context.event,
        cancelledBy: context.label,
        offeredTo: await offeredLabels(outcome.offered),
      });
    } catch (err) {
      console.error(`Failed to send lead cancellation notice for event ${eventId}:`, err);
    }
  }

  return { ok: true, status: "cancelled" };
}

/**
 * The offered person's "Claim your spot" button. The claim_offered_spot RPC
 * re-checks the offer and takes the spot through the same capacity function
 * every RSVP uses, so it can't overbook. On success, sends the normal
 * confirmation email (with the calendar invite).
 */
export async function claimOfferedSpotAction(eventId: number): Promise<RsvpActionResult> {
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) {
    return { ok: false, error: "Not authenticated" };
  }
  const userId = claims.claims.sub as string;

  const { data, error } = await supabase.rpc("claim_offered_spot", { p_event_id: eventId });
  if (error) {
    console.error(`[claim-spot] event ${eventId}: claim_offered_spot failed:`, error);
    return { ok: false, error: error.message };
  }
  if (data !== "confirmed") {
    const reason =
      data === "expired"
        ? "Your offer has expired."
        : data === "capacity_exceeded"
          ? "Sorry, this spot is no longer available."
          : "You don't have an open offer for this event.";
    return { ok: false, error: reason };
  }

  try {
    const context = await loadEmailContext(supabase, eventId, userId);
    if (context) {
      await sendRsvpConfirmationEmail({
        event: context.event,
        toEmail: context.toEmail,
        status: "confirmed",
      });
    }
  } catch (err) {
    console.error(`Failed to send confirmation email after claim for event ${eventId}:`, err);
  }

  return { ok: true, status: "confirmed" };
}
