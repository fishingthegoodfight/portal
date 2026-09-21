"use server";

import { createClient } from "@/lib/supabase/server";
import {
  sendLeadParticipantCancelledEmail,
  sendRsvpCancellationEmail,
  sendRsvpConfirmationEmail,
  type RsvpEmailEvent,
} from "@/lib/email/send";
import { emailWaitlistOffers, offeredLabels, type OfferedSpot } from "@/lib/waitlist";

export type RsvpActionResult = { ok: true; status: string } | { ok: false; error: string };

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const EVENT_EMAIL_COLUMNS =
  "id, name, starts_at, ends_at, timezone, location, lead_name, lead_phone, lead_email, custom_email_note, ics_sequence";

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

/**
 * Confirms (or updates) the caller's RSVP via the rsvp_to_event RPC, then
 * sends the confirmation email. A failed database write fails the action; a
 * failed email does not — it's logged and swallowed so the RSVP still
 * stands.
 */
export async function confirmRsvpAction(
  eventId: number,
  dietaryNotes: string | null,
): Promise<RsvpActionResult> {
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) {
    return { ok: false, error: "Not authenticated" };
  }
  const userId = claims.claims.sub as string;

  const { data, error } = await supabase.rpc("rsvp_to_event", {
    p_event_id: eventId,
    p_dietary: dietaryNotes,
  });
  if (error) {
    return { ok: false, error: error.message };
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
