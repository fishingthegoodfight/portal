"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireEventManager } from "@/lib/admin/require-admin";
import { parseDollars } from "@/lib/retreats";
import { emailOffer, emailRoomDecision } from "@/lib/retreat-emails";
import type { RoomStatus } from "@/lib/retreat-registration";

/**
 * Managing a retreat's registrations: offers, the waitlist, cancelling,
 * room requests and private price links. For whoever manages the retreat
 * (admins and its lead); the database functions check that again.
 */

export type RetreatAdminResult<T = null> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

async function registration(supabase: Awaited<ReturnType<typeof createClient>>, id: number) {
  const { data } = await supabase
    .from("retreat_registrations")
    .select("id, event_id, user_id, status")
    .eq("id", id)
    .maybeSingle();
  return data as { id: number; event_id: number; user_id: string | null; status: string } | null;
}

/** Offers a waitlisted person a spot and emails them the link and deadline. */
export async function offerRetreatSpotAction(registrationId: number): Promise<RetreatAdminResult<{ emailed: boolean }>> {
  const supabase = await createClient();
  const reg = await registration(supabase, registrationId);
  if (!reg) return fail("Registration not found");
  const gate = await requireEventManager(supabase, reg.event_id);
  if ("error" in gate) return fail(gate.error);
  const { data: expiresAt, error } = await supabase.rpc("retreat_admin_offer", { p_registration_id: registrationId });
  if (error) return fail(error.message);
  const emailed = reg.user_id ? await emailOffer(reg.event_id, reg.user_id, expiresAt as string) : false;
  return { ok: true, data: { emailed } };
}

export async function returnToWaitlistAction(registrationId: number): Promise<RetreatAdminResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("retreat_admin_return_to_waitlist", { p_registration_id: registrationId });
  if (error) return fail(error.message);
  return { ok: true, data: null };
}

export async function cancelRetreatRegistrationAction(registrationId: number, note: string): Promise<RetreatAdminResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("retreat_admin_cancel", { p_registration_id: registrationId, p_note: note });
  if (error) return fail(error.message);
  return { ok: true, data: null };
}

/** Approves or declines a room request (emails the person), or puts it
 * back to pending (no email). */
export async function setRoomRequestStatusAction(registrationId: number, status: RoomStatus): Promise<RetreatAdminResult> {
  const supabase = await createClient();
  const reg = await registration(supabase, registrationId);
  if (!reg) return fail("Registration not found");
  const { error } = await supabase.rpc("retreat_admin_set_room_status", {
    p_registration_id: registrationId,
    p_status: status,
  });
  if (error) return fail(error.message);
  if (status !== "pending" && reg.user_id) await emailRoomDecision(reg.event_id, reg.user_id, status === "approved");
  return { ok: true, data: null };
}

/** A private price link for one person. Returns the token. */
export async function createCustomPriceAction(
  eventId: number,
  amount: string,
  note: string,
): Promise<RetreatAdminResult<{ token: string }>> {
  const supabase = await createClient();
  const gate = await requireEventManager(supabase, eventId);
  if ("error" in gate) return fail(gate.error);
  const cents = parseDollars(amount);
  if (cents == null) return fail("Give an amount in dollars ($0 is fine)");
  if (!note.trim()) return fail("Say who it's for");
  if (note.trim().length > 200) return fail("Keep the note under 200 characters");
  const { data, error } = await supabase.rpc("retreat_admin_create_custom_price", {
    p_event_id: eventId,
    p_amount_cents: cents,
    p_note: note,
  });
  if (error) return fail(error.message);
  return { ok: true, data: { token: data as string } };
}

export async function revokeCustomPriceAction(id: number): Promise<RetreatAdminResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("retreat_admin_revoke_custom_price", { p_id: id });
  if (error) return fail(error.message);
  return { ok: true, data: null };
}

/** How long a waitlist offer is held. Admins only. */
export async function saveRetreatSettingsAction(offerHours: string): Promise<RetreatAdminResult> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if ("error" in gate) return fail(gate.error);
  const hours = Number(offerHours.trim());
  if (!Number.isInteger(hours) || hours < 1 || hours > 336) return fail("Hours is a whole number from 1 to 336 (two weeks)");
  const { error } = await supabase
    .from("retreat_settings")
    .update({ offer_hours: hours, updated_by: gate.actor.userId, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) return fail(error.message);
  return { ok: true, data: null };
}
