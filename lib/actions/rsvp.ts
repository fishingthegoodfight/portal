"use server";

import { createClient } from "@/lib/supabase/server";
import {
  sendRsvpCancellationEmail,
  sendRsvpConfirmationEmail,
  type RsvpEmailEvent,
} from "@/lib/email/send";

export type RsvpActionResult =
  | { ok: true; status: string }
  | { ok: false; error: string };

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const EVENT_EMAIL_COLUMNS =
  "id, name, starts_at, ends_at, timezone, location, lead_name, lead_phone, lead_email, custom_email_note, ics_sequence";

async function loadEmailContext(
  supabase: SupabaseServerClient,
  eventId: number,
  userId: string,
): Promise<{ event: RsvpEmailEvent; toEmail: string } | null> {
  const [{ data: event }, { data: profile }] = await Promise.all([
    supabase.from("events").select(EVENT_EMAIL_COLUMNS).eq("id", eventId).maybeSingle(),
    supabase.from("profiles").select("email").eq("id", userId).maybeSingle(),
  ]);
  if (!event || !profile?.email) return null;
  return { event: event as RsvpEmailEvent, toEmail: profile.email as string };
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
 * Cancels the caller's RSVP via the cancel_rsvp RPC, then sends the
 * cancellation email. Same failure handling as confirmRsvpAction: a database
 * error fails the action, an email error only gets logged.
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

  const { error } = await supabase.rpc("cancel_rsvp", { p_event_id: eventId });
  if (error) {
    return { ok: false, error: error.message };
  }

  try {
    if (context) {
      await sendRsvpCancellationEmail({ event: context.event, toEmail: context.toEmail });
    }
  } catch (err) {
    console.error(`Failed to send RSVP cancellation email for event ${eventId}:`, err);
  }

  return { ok: true, status: "cancelled" };
}
