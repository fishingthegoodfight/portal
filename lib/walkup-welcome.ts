import type { createAdminClient } from "@/lib/supabase/admin";
import { buildConfirmUrl } from "@/lib/auth-confirm-link";
import { bulkSendGapMs, sendWalkupWelcomeEmail } from "@/lib/email/send";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * The welcome email for accounts created at a walk-up (walkup_welcome_emails,
 * 2026-10-06 entry in schema-changes.sql). A walk-up for someone with no
 * account creates one with a random password, so without this they have an
 * account they don't know about and can't use.
 *
 *  - Automatic: addWalkupRsvpAction queues a row when it creates the account;
 *    runWalkupWelcomeEmails (the daily 15:00 UTC reminders job) sends it the
 *    morning after the event's last day, skipping anyone who has signed in.
 *  - Catch-up: accounts made before this existed, sent only when an admin
 *    picks them on Setup → Walk-up welcome emails.
 *
 * The link is a one-time set-password ("recovery") link, the same kind a
 * re-sent invite uses. Once it expires it lands on /auth/error, which lets
 * them email themselves a new one.
 */

/** Where setting the password takes them. */
const AFTER_PASSWORD_PATH = "/protected/events";

/** A failed automatic send is retried on later runs up to this many tries. */
export const WALKUP_WELCOME_MAX_ATTEMPTS = 3;

/** One person to welcome: walkup_welcome_candidates / walkup_welcome_due. */
export type WalkupWelcomeRecipient = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  eventId: number;
  eventName: string;
  eventStartsAt: string;
  eventEndsAt: string | null;
  timeZone: string;
  leadName: string | null;
  chapterName: string | null;
  accountCreatedAt: string;
};

type RecipientRow = {
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  event_id: number;
  event_name: string;
  event_starts_at: string;
  event_ends_at: string | null;
  event_timezone: string;
  lead_name: string | null;
  chapter_name: string | null;
  account_created_at: string;
};

function toRecipient(row: RecipientRow): WalkupWelcomeRecipient {
  return {
    userId: row.user_id,
    email: (row.email ?? "").trim(),
    firstName: (row.first_name ?? "").trim(),
    lastName: (row.last_name ?? "").trim(),
    eventId: row.event_id,
    eventName: row.event_name,
    eventStartsAt: row.event_starts_at,
    eventEndsAt: row.event_ends_at,
    timeZone: row.event_timezone,
    leadName: row.lead_name,
    chapterName: row.chapter_name,
    accountCreatedAt: row.account_created_at,
  };
}

/** "on Monday" when the event started within the last 6 days, otherwise
 * "on October 5" — in the event's own time zone. */
export function eventDayPhrase(startsAt: string, timeZone: string, now: Date): string {
  const start = new Date(startsAt);
  const recent = now.getTime() - start.getTime() < 6 * 86_400_000;
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone,
    ...(recent ? { weekday: "long" } : { month: "long", day: "numeric" }),
  }).format(start);
  return `on ${label}`;
}

/** Sends one welcome. Throws on failure; recording it is the caller's job. */
export async function sendWalkupWelcome(
  admin: AdminClient,
  recipient: WalkupWelcomeRecipient,
  now: Date,
): Promise<void> {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "recovery", email: recipient.email });
  if (error || !link?.properties) throw error ?? new Error("no link returned");
  await sendWalkupWelcomeEmail({
    toEmail: recipient.email,
    firstName: recipient.firstName || null,
    eventName: recipient.eventName,
    dayPhrase: eventDayPhrase(recipient.eventStartsAt, recipient.timeZone, now),
    leadName: recipient.leadName,
    chapterName: recipient.chapterName,
    actionUrl: buildConfirmUrl(
      link.properties.hashed_token,
      "recovery",
      `/auth/update-password?next=${encodeURIComponent(AFTER_PASSWORD_PATH)}`,
    ),
  });
}

/** The catch-up list: walk-up-created accounts never signed in and never
 * sent a welcome (walkup_welcome_candidates). */
export async function loadWalkupWelcomeCandidates(admin: AdminClient): Promise<WalkupWelcomeRecipient[]> {
  const { data, error } = await admin.rpc("walkup_welcome_candidates");
  if (error) throw new Error(`walkup_welcome_candidates: ${error.message}`);
  return ((data ?? []) as RecipientRow[]).map(toRecipient).filter((r) => r.email);
}

export type WalkupWelcomeRunSummary = {
  due: number;
  sent: string[];
  failed: string[];
};

/**
 * The automatic sends, from the daily reminders job: every queued walk-up
 * whose event's last day ended before today (event time zone), within a
 * week, never signed in (walkup_welcome_due). A sent row is stamped; a
 * failure counts an attempt and is retried on the next run, up to
 * WALKUP_WELCOME_MAX_ATTEMPTS. `dry` sends and records nothing.
 */
export async function runWalkupWelcomeEmails(
  admin: AdminClient,
  { now, dry = false }: { now: Date; dry?: boolean },
): Promise<WalkupWelcomeRunSummary> {
  const { data, error } = await admin.rpc("walkup_welcome_due", { p_now: now.toISOString() });
  if (error) throw new Error(`walkup_welcome_due: ${error.message}`);
  const due = ((data ?? []) as RecipientRow[]).map(toRecipient).filter((r) => r.email);
  const summary: WalkupWelcomeRunSummary = { due: due.length, sent: [], failed: [] };
  if (dry) return summary;

  const gap = bulkSendGapMs();
  for (const [index, recipient] of due.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, gap));
    try {
      await sendWalkupWelcome(admin, recipient, now);
      await admin
        .from("walkup_welcome_emails")
        .update({ sent_at: new Date().toISOString(), last_error: null })
        .eq("user_id", recipient.userId);
      summary.sent.push(recipient.userId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const { data: row } = await admin
        .from("walkup_welcome_emails")
        .select("attempts")
        .eq("user_id", recipient.userId)
        .maybeSingle();
      await admin
        .from("walkup_welcome_emails")
        .update({ attempts: ((row?.attempts as number | undefined) ?? 0) + 1, last_error: message })
        .eq("user_id", recipient.userId);
      summary.failed.push(`${recipient.userId}: ${message}`);
    }
  }
  return summary;
}
