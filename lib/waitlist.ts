import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendRsvpCancellationEmail,
  sendWaitlistOfferEmail,
  sendWaitlistOfferExpiredEmail,
  type RsvpEmailEvent,
} from "@/lib/email/send";

/**
 * Server-only helpers shared by the waitlist flows (participant cancel,
 * admin remove/offer, capacity increase, the expiry cron). The database
 * functions (see schema-changes.sql, 2026-09-21) decide WHO gets offered;
 * these send the emails afterward. Emailing someone other than the caller
 * means reading another member's profile, which RLS blocks — hence the
 * service-role client throughout.
 *
 * Nothing here throws: a failed email is logged and never undoes the
 * database change it follows (the offered person still sees the offer on
 * the event page).
 */

/** One row of what the offer functions return. */
export type OfferedSpot = { user_id: string; expires_at: string };

const EVENT_EMAIL_COLUMNS =
  "id, name, starts_at, ends_at, timezone, location, lead_name, lead_phone, lead_email, custom_email_note, ics_sequence, status";

type AdminClient = ReturnType<typeof createAdminClient>;
type EmailEventRow = RsvpEmailEvent & { status: string };

async function loadEmailEvent(admin: AdminClient, eventId: number): Promise<EmailEventRow | null> {
  const { data } = await admin
    .from("events")
    .select(EVENT_EMAIL_COLUMNS)
    .eq("id", eventId)
    .maybeSingle();
  return (data as EmailEventRow | null) ?? null;
}

export type WaitlistProfile = { email: string; label: string };

/** userId -> email and a "First Last" label (email if unnamed). */
export async function loadProfilesById(
  admin: AdminClient,
  userIds: string[],
): Promise<Map<string, WaitlistProfile>> {
  const byId = new Map<string, WaitlistProfile>();
  if (userIds.length === 0) return byId;
  const { data } = await admin
    .from("profiles")
    .select("id, email, first_name, last_name")
    .in("id", userIds);
  for (const p of data ?? []) {
    const email = (p.email as string | null) ?? "";
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
    byId.set(p.id as string, { email, label: name || email || "(unknown)" });
  }
  return byId;
}

/** Emails the "a spot opened" message to each newly offered person. Returns
 * how many went out. */
export async function emailWaitlistOffers(eventId: number, offers: OfferedSpot[]): Promise<number> {
  if (offers.length === 0) return 0;
  let sent = 0;
  try {
    const admin = createAdminClient();
    const event = await loadEmailEvent(admin, eventId);
    if (!event) return 0;
    const profiles = await loadProfilesById(
      admin,
      offers.map((o) => o.user_id),
    );
    for (const offer of offers) {
      const toEmail = profiles.get(offer.user_id)?.email;
      if (!toEmail) {
        console.warn(`[waitlist] event ${eventId}: no email for offered user ${offer.user_id}`);
        continue;
      }
      try {
        await sendWaitlistOfferEmail({ event, toEmail, expiresAt: offer.expires_at });
        sent++;
      } catch (err) {
        console.error(`[waitlist] event ${eventId}: offer email to ${toEmail} failed:`, err);
      }
    }
  } catch (err) {
    console.error(`[waitlist] event ${eventId}: failed to send offer emails:`, err);
  }
  return sent;
}

/** Emails "your offer lapsed" — skipped for an event that was cancelled or
 * has already started (nothing left to rejoin). `now` is the cron's clock,
 * which is faked in dev. */
export async function emailLapsedOffers(
  eventId: number,
  userIds: string[],
  now: Date,
): Promise<number> {
  if (userIds.length === 0) return 0;
  let sent = 0;
  try {
    const admin = createAdminClient();
    const event = await loadEmailEvent(admin, eventId);
    if (!event || event.status !== "scheduled" || new Date(event.starts_at) <= now) return 0;
    const profiles = await loadProfilesById(admin, userIds);
    for (const userId of userIds) {
      const toEmail = profiles.get(userId)?.email;
      if (!toEmail) continue;
      try {
        await sendWaitlistOfferExpiredEmail({ event, toEmail });
        sent++;
      } catch (err) {
        console.error(`[waitlist] event ${eventId}: lapse email to ${toEmail} failed:`, err);
      }
    }
  } catch (err) {
    console.error(`[waitlist] event ${eventId}: failed to send lapse emails:`, err);
  }
  return sent;
}

/** Tells someone an admin removed them from an event (the same neutral
 * "RSVP cancelled" email a self-cancel sends, with the calendar cancel). */
export async function emailRemovedParticipant(eventId: number, userId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const event = await loadEmailEvent(admin, eventId);
    const toEmail = (await loadProfilesById(admin, [userId])).get(userId)?.email;
    if (!event || !toEmail) return;
    await sendRsvpCancellationEmail({ event, toEmail });
  } catch (err) {
    console.error(`[waitlist] event ${eventId}: removal email failed:`, err);
  }
}

/** Offers any free spots on an event to the waitlist (e.g. after a capacity
 * increase) and emails whoever got one. */
export async function offerFreeSpots(eventId: number): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("offer_waitlisted_spots", { p_event_id: eventId });
    if (error) throw error;
    const offers = ((data ?? []) as { o_user_id: string; o_expires_at: string }[]).map((o) => ({
      user_id: o.o_user_id,
      expires_at: o.o_expires_at,
    }));
    await emailWaitlistOffers(eventId, offers);
  } catch (err) {
    console.error(`[waitlist] event ${eventId}: failed to offer free spots:`, err);
  }
}

/** Display labels ("First Last") for offered users, for the lead's email. */
export async function offeredLabels(offers: OfferedSpot[]): Promise<string[]> {
  if (offers.length === 0) return [];
  try {
    const profiles = await loadProfilesById(
      createAdminClient(),
      offers.map((o) => o.user_id),
    );
    return offers.map((o) => profiles.get(o.user_id)?.label ?? "someone on the waitlist");
  } catch {
    return offers.map(() => "someone on the waitlist");
  }
}
