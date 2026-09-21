"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { emailRemovedParticipant, emailWaitlistOffers, type OfferedSpot } from "@/lib/waitlist";

export type AdminWaitlistResult = { ok: true } | { ok: false; error: string };

const OFFER_ERRORS: Record<string, string> = {
  not_found: "That RSVP no longer exists.",
  not_waitlisted: "That person is no longer waiting for a spot.",
  event_unavailable: "This event can't take offers (cancelled or unpublished).",
  no_capacity:
    "There's no open spot to offer — every spot is confirmed or already held by an open offer. Remove someone or raise the capacity first.",
};

/**
 * Manual "Offer spot now" for one waitlisted (or lapsed) person, out of
 * order if the admin likes. The RPC only allows it when a spot is genuinely
 * free, so the offer can always be claimed. Emails the offer on success.
 */
export async function adminOfferSpotAction(rsvpId: number): Promise<AdminWaitlistResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { data, error } = await supabase.rpc("admin_offer_spot", { p_rsvp_id: rsvpId });
  if (error) {
    console.error(`[admin-offer] rsvp ${rsvpId}: admin_offer_spot failed:`, error);
    return { ok: false, error: error.message };
  }

  const result = data as {
    ok: boolean;
    reason?: string;
    event_id?: number;
    user_id?: string;
    expires_at?: string;
  };
  if (!result.ok) {
    return { ok: false, error: OFFER_ERRORS[result.reason ?? ""] ?? "Couldn't offer the spot." };
  }

  await emailWaitlistOffers(result.event_id!, [
    { user_id: result.user_id!, expires_at: result.expires_at! },
  ]);
  return { ok: true };
}

/**
 * Removes anyone (confirmed, waitlisted, offered, or lapsed) from an event.
 * Removing a confirmed person or voiding an open offer frees a spot, which
 * the RPC immediately offers to the next waitlisted person — same as a
 * participant cancelling. The removed person gets a cancellation email
 * (unless their offer had already lapsed), and whoever was offered the freed
 * spot gets the offer email.
 */
export async function adminRemoveRsvpAction(
  rsvpId: number,
  eventId: number,
): Promise<AdminWaitlistResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { data, error } = await supabase.rpc("admin_remove_rsvp", { p_rsvp_id: rsvpId });
  if (error) {
    console.error(`[admin-remove] rsvp ${rsvpId}: admin_remove_rsvp failed:`, error);
    return { ok: false, error: error.message };
  }

  const result = data as {
    removed: boolean;
    previous_status?: string;
    user_id?: string;
    offered: OfferedSpot[];
  };
  if (!result?.removed) {
    console.error(`[admin-remove] rsvp ${rsvpId}: nothing removed; response:`, data);
    return { ok: false, error: "That RSVP no longer exists (or was already removed)." };
  }

  if (result.user_id && result.previous_status !== "expired") {
    await emailRemovedParticipant(eventId, result.user_id);
  }
  await emailWaitlistOffers(eventId, result.offered);
  return { ok: true };
}
