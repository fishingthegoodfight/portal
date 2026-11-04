"use server";

import { createClient } from "@/lib/supabase/server";
import { parseDollars } from "@/lib/retreats";
import { emailRegistration } from "@/lib/retreat-emails";
import type { RegistrationStatus } from "@/lib/retreat-registration";

/**
 * The participant's side of retreat registration. Every rule (waiver,
 * questions, health form, capacity, price) is checked again by the database
 * functions these call; the form's own checks are only for saying so sooner.
 * Profile answers and the waiver signature are saved by the form first,
 * exactly as on the RSVP form.
 */

export type RegistrationResult = { ok: true; status: RegistrationStatus } | { ok: false; error: string };

export type RegistrationAnswers = {
  /** retreat_price_options.id; ignored with a custom price link. */
  priceOptionId: number | null;
  /** The token from a private price link, or "". */
  customToken: string;
  /** Raw dollars; blank = none. */
  donation: string;
  roomRequest: boolean;
  roomReason: string;
};

function donationCents(value: string): number | { error: string } {
  if (!value.trim()) return 0;
  const cents = parseDollars(value);
  if (cents == null) return { error: "The donation is an amount in dollars, or blank" };
  return cents;
}

export async function registerForRetreatAction(eventId: number, answers: RegistrationAnswers): Promise<RegistrationResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return { ok: false, error: "Please sign in again" };
  const donation = donationCents(answers.donation);
  if (typeof donation !== "number") return { ok: false, error: donation.error };

  const { data, error } = await supabase.rpc("retreat_register", {
    p_event_id: eventId,
    p_price_option_id: answers.priceOptionId,
    p_custom_token: answers.customToken || null,
    p_donation_cents: donation,
    p_room_request: answers.roomRequest,
    p_room_reason: answers.roomRequest ? answers.roomReason : null,
  });
  if (error) return { ok: false, error: error.message };
  const status = (data as { status: RegistrationStatus }).status;
  await emailRegistration(
    eventId,
    auth.claims.sub as string,
    status === "confirmed" ? "confirmed" : status === "waitlisted" ? "waitlisted" : "pending_payment",
    answers.roomRequest,
  );
  return { ok: true, status };
}

export async function updateRetreatRegistrationAction(
  eventId: number,
  answers: RegistrationAnswers,
): Promise<RegistrationResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return { ok: false, error: "Please sign in again" };
  const donation = donationCents(answers.donation);
  if (typeof donation !== "number") return { ok: false, error: donation.error };

  const { data: before } = await supabase
    .from("retreat_registrations")
    .select("status")
    .eq("event_id", eventId)
    .eq("user_id", auth.claims.sub as string)
    .maybeSingle();
  const { data, error } = await supabase.rpc("retreat_update_registration", {
    p_event_id: eventId,
    p_price_option_id: answers.priceOptionId,
    p_donation_cents: donation,
    p_room_request: answers.roomRequest,
    p_room_reason: answers.roomRequest ? answers.roomReason : null,
  });
  if (error) return { ok: false, error: error.message };
  const status = (data as { status: RegistrationStatus }).status;
  // Down to nothing owed, and that confirmed them.
  if (status === "confirmed" && before?.status !== "confirmed") {
    await emailRegistration(eventId, auth.claims.sub as string, "confirmed", answers.roomRequest);
  }
  return { ok: true, status };
}

export async function withdrawFromRetreatAction(eventId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("retreat_withdraw", { p_event_id: eventId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** "Nothing has changed": the pre-retreat check's health form step. */
export async function confirmRetreatHealthFormAction(eventId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("retreat_confirm_health_form", { p_event_id: eventId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
