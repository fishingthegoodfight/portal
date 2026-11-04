import { createAdminClient } from "@/lib/supabase/admin";
import { adminNotificationRecipients, sendRetreatEmail } from "@/lib/email/send";
import {
  retreatAdminOfferExpiredEmail,
  retreatOfferEmail,
  retreatOfferExpiredEmail,
  retreatPrecheckEmail,
  retreatRegistrationEmail,
  retreatRoomDecisionEmail,
  type PrecheckEmailKind,
  type RegistrationEmailStatus,
  type RetreatEmailInfo,
} from "@/lib/email/retreat-templates";
import { formatEventDateRange, formatEventInstant } from "@/lib/format-date";
import { getSiteUrl } from "@/lib/site-url";

/**
 * Sends the retreat registration emails. Each loads what it needs with the
 * service role (the person's email, the retreat's name and dates) after the
 * caller has done the gated action, and never throws: a failed send is
 * logged and the action it follows still stands.
 */

type Retreat = { id: number; name: string; starts_at: string; ends_at: string | null; timezone: string; lead_user_id: string | null };
type Person = { email: string | null; first_name: string | null; last_name: string | null };

async function load(eventId: number, userId: string): Promise<{ retreat: Retreat; person: Person } | null> {
  const admin = createAdminClient();
  const [{ data: retreat }, { data: person }] = await Promise.all([
    admin.from("events").select("id, name, starts_at, ends_at, timezone, lead_user_id").eq("id", eventId).maybeSingle(),
    admin.from("profiles").select("email, first_name, last_name").eq("id", userId).maybeSingle(),
  ]);
  if (!retreat || !person?.email) return null;
  return { retreat: retreat as Retreat, person: person as Person };
}

function info(retreat: Retreat, person: Person | null): RetreatEmailInfo {
  return {
    recipientName: person?.first_name?.trim() || null,
    retreatName: retreat.name,
    dateRange: formatEventDateRange(retreat.starts_at, retreat.ends_at, retreat.timezone),
    retreatUrl: `${getSiteUrl()}/protected/retreats/${retreat.id}`,
  };
}

async function attempt(label: string, send: () => Promise<void>): Promise<boolean> {
  try {
    await send();
    return true;
  } catch (err) {
    console.error(`[retreat-email] ${label} failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}

export async function emailRegistration(
  eventId: number,
  userId: string,
  status: RegistrationEmailStatus,
  roomRequested: boolean,
): Promise<void> {
  const loaded = await load(eventId, userId);
  if (!loaded) return;
  await attempt(`registration ${status} (event ${eventId})`, () =>
    sendRetreatEmail(loaded.person.email!, retreatRegistrationEmail(info(loaded.retreat, loaded.person), status, { roomRequested })),
  );
}

export async function emailOffer(eventId: number, userId: string, expiresAt: string): Promise<boolean> {
  const loaded = await load(eventId, userId);
  if (!loaded) return false;
  return attempt(`offer (event ${eventId})`, () =>
    sendRetreatEmail(
      loaded.person.email!,
      retreatOfferEmail(info(loaded.retreat, loaded.person), formatEventInstant(expiresAt, loaded.retreat.timezone)),
    ),
  );
}

/** The person, and the admins plus the retreat lead ("offer the next one"). */
export async function emailOfferExpired(eventId: number, userId: string | null): Promise<void> {
  const admin = createAdminClient();
  const loaded = userId ? await load(eventId, userId) : null;
  const { data: retreat } = await admin
    .from("events")
    .select("id, name, starts_at, ends_at, timezone, lead_user_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!retreat) return;
  const r = retreat as Retreat;
  if (loaded) {
    await attempt(`offer expired (event ${eventId})`, () =>
      sendRetreatEmail(loaded.person.email!, retreatOfferExpiredEmail(info(r, loaded.person))),
    );
  }
  const recipients = new Set(adminNotificationRecipients());
  if (r.lead_user_id) {
    const { data: lead } = await admin.from("profiles").select("email").eq("id", r.lead_user_id).maybeSingle();
    if (lead?.email) recipients.add(lead.email as string);
  }
  if (recipients.size === 0) return;
  const personName =
    [loaded?.person.first_name, loaded?.person.last_name].filter(Boolean).join(" ").trim() || "Someone";
  await attempt(`admin offer-expired notice (event ${eventId})`, () =>
    sendRetreatEmail(
      [...recipients],
      retreatAdminOfferExpiredEmail({
        personName,
        retreatName: r.name,
        dateRange: formatEventDateRange(r.starts_at, r.ends_at, r.timezone),
        registrationsUrl: `${getSiteUrl()}/protected/admin/retreats/${eventId}/registrations`,
      }),
    ),
  );
}

export async function emailRoomDecision(eventId: number, userId: string, approved: boolean): Promise<void> {
  const loaded = await load(eventId, userId);
  if (!loaded) return;
  await attempt(`room decision (event ${eventId})`, () =>
    sendRetreatEmail(loaded.person.email!, retreatRoomDecisionEmail(info(loaded.retreat, loaded.person), approved)),
  );
}

/** Throws on failure (the daily job counts and retries). */
export async function emailPrecheck(
  retreat: Retreat,
  person: Person & { email: string },
  kind: PrecheckEmailKind,
  dueLabel: string,
): Promise<void> {
  await sendRetreatEmail(person.email, retreatPrecheckEmail(info(retreat, person), kind, dueLabel));
}
