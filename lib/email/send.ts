import { Resend } from "resend";

import { formatEventDateRange } from "@/lib/format-date";
import { getSiteUrl } from "@/lib/site-url";
import { buildEventIcs, buildGoogleCalendarLink } from "@/lib/email/ics";
import {
  adminChangeNotificationEmail,
  cancellationEmail,
  confirmationEmail,
  eventCancellationEmail,
  eventRestoredEmail,
  eventUpdateEmail,
  reminderEmail,
  type ReminderKind,
  type EventChangeDiffEntry,
  type EventChangeAction,
  type RsvpEmailEventInfo,
} from "@/lib/email/templates";

// Defaults to a resend.dev test sender so this works before the org's
// domain is verified with Resend.
const FROM_ADDRESS =
  process.env.RESEND_FROM || "Fishing the Good Fight <onboarding@resend.dev>";
const REPLY_TO = "tcramer@fishingthegoodfight.org";

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }
  return new Resend(apiKey);
}

/** The event columns every RSVP/event email needs — see the
 * 2026-09-18 schema-changes.sql entries for lead_name/lead_phone/
 * custom_email_note and (later) ics_sequence. */
export type RsvpEmailEvent = {
  id: number;
  name: string;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  location: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  custom_email_note: string | null;
  /** events.ics_sequence as of the write that triggered this send — the
   * caller is responsible for bumping and persisting it first when the
   * calendar entry actually changed (date/time/location edit, or a
   * cancellation); a plain new RSVP confirmation just reads it as-is. */
  ics_sequence: number;
};

function buildEventInfo(event: RsvpEmailEvent): RsvpEmailEventInfo {
  const icsEvent = {
    id: event.id,
    name: event.name,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    timezone: event.timezone,
    location: event.location,
  };

  return {
    name: event.name,
    dateRange: formatEventDateRange(event.starts_at, event.ends_at, event.timezone),
    location: event.location,
    leadName: event.lead_name,
    leadPhone: event.lead_phone,
    leadEmail: event.lead_email,
    customNote: event.custom_email_note,
    eventUrl: `${getSiteUrl()}/protected/events/${event.id}/rsvp`,
    googleCalendarUrl: buildGoogleCalendarLink(icsEvent),
  };
}

function buildIcsAttachment(
  event: RsvpEmailEvent,
  method: "REQUEST" | "CANCEL",
): { filename: string; content: string; contentType: string } {
  const ics = buildEventIcs({
    method,
    sequence: event.ics_sequence,
    event: {
      id: event.id,
      name: event.name,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      timezone: event.timezone,
      location: event.location,
    },
  });
  return {
    filename: method === "CANCEL" ? "cancel.ics" : "event.ics",
    content: Buffer.from(ics, "utf-8").toString("base64"),
    contentType: `text/calendar; method=${method}; charset=UTF-8`,
  };
}

/**
 * Sends the RSVP confirmation email with a METHOD:REQUEST .ics attached.
 * Throws on failure — callers (the confirm/cancel RSVP server actions) are
 * responsible for catching, logging, and not failing the RSVP over it.
 */
export async function sendRsvpConfirmationEmail({
  event,
  toEmail,
  status,
}: {
  event: RsvpEmailEvent;
  toEmail: string;
  status: "confirmed" | "waitlisted";
}): Promise<void> {
  const resend = getResendClient();
  const info = buildEventInfo(event);
  const { subject, html, text } = confirmationEmail(info, status);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    replyTo: REPLY_TO,
    subject,
    html,
    text,
    attachments: [buildIcsAttachment(event, "REQUEST")],
  });
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Sends the RSVP cancellation email with a METHOD:CANCEL .ics attached,
 * reusing the same UID as the confirmation so calendars update the existing
 * entry instead of adding a duplicate. Throws on failure — see above.
 */
export async function sendRsvpCancellationEmail({
  event,
  toEmail,
}: {
  event: RsvpEmailEvent;
  toEmail: string;
}): Promise<void> {
  const resend = getResendClient();
  const info = buildEventInfo(event);
  const { subject, html, text } = cancellationEmail(info);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    replyTo: REPLY_TO,
    subject,
    html,
    text,
    attachments: [buildIcsAttachment(event, "CANCEL")],
  });
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Renders (without sending) the event cancellation email so the admin
 * cancel flow can show an exact preview before requiring confirmation.
 */
export function previewEventCancellationEmail(event: RsvpEmailEvent, reason: string) {
  return eventCancellationEmail(buildEventInfo(event), reason);
}

/**
 * The organizer-initiated event cancellation email (distinct from a
 * member's own RSVP cancellation above) — always carries a reason, and a
 * METHOD:CANCEL .ics at `event.ics_sequence`, which the caller must have
 * already bumped past whatever sequence attendees last saw.
 */
export async function sendEventCancellationEmail({
  event,
  toEmail,
  reason,
}: {
  event: RsvpEmailEvent;
  toEmail: string;
  reason: string;
}): Promise<void> {
  const resend = getResendClient();
  const info = buildEventInfo(event);
  const { subject, html, text } = eventCancellationEmail(info, reason);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    replyTo: REPLY_TO,
    subject,
    html,
    text,
    attachments: [buildIcsAttachment(event, "CANCEL")],
  });
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Sent to confirmed attendees when an admin edit changes the date, time, or
 * location and the admin opts to notify them. Carries a revised
 * METHOD:REQUEST .ics at the bumped `event.ics_sequence`.
 */
export async function sendEventUpdateEmail({
  event,
  toEmail,
}: {
  event: RsvpEmailEvent;
  toEmail: string;
}): Promise<void> {
  const resend = getResendClient();
  const info = buildEventInfo(event);
  const { subject, html, text } = eventUpdateEmail(info);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    replyTo: REPLY_TO,
    subject,
    html,
    text,
    attachments: [buildIcsAttachment(event, "REQUEST")],
  });
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Sent to confirmed attendees when a previously-cancelled event is
 * restored, opted into by the admin. Carries a fresh METHOD:REQUEST .ics at
 * the bumped `event.ics_sequence`.
 */
export async function sendEventRestoredEmail({
  event,
  toEmail,
}: {
  event: RsvpEmailEvent;
  toEmail: string;
}): Promise<void> {
  const resend = getResendClient();
  const info = buildEventInfo(event);
  const { subject, html, text } = eventRestoredEmail(info);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    replyTo: REPLY_TO,
    subject,
    html,
    text,
    attachments: [buildIcsAttachment(event, "REQUEST")],
  });
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Internal notification fanned out to every address in
 * ADMIN_NOTIFICATION_EMAILS (comma-separated) on every event create, edit,
 * or cancellation — including changes made by someone on that list, and
 * regardless of whether attendees were separately notified. A no-op (not an
 * error) when the env var isn't set.
 *
 * Logs the parsed recipient list and the raw Resend response either way —
 * Resend's test sender (the resend.dev default FROM address, before a
 * domain is verified) silently only delivers to the account owner's own
 * address, so without this a "successful" send to anyone else looks
 * identical to one that actually landed. Look for these two lines in the
 * dev server output when a notification doesn't arrive.
 */
export async function sendAdminChangeNotificationEmail(params: {
  action: EventChangeAction;
  actorLabel: string;
  eventName: string;
  eventId: number;
  diff: EventChangeDiffEntry[];
  reason?: string | null;
}): Promise<void> {
  const recipients = (process.env.ADMIN_NOTIFICATION_EMAILS ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  console.log(
    `[admin-notify] event ${params.eventId} (${params.action}): ADMIN_NOTIFICATION_EMAILS parsed to`,
    recipients.length > 0 ? recipients : "(empty — not set, skipping send)",
  );
  if (recipients.length === 0) return;

  const resend = getResendClient();
  const { subject, html, text } = adminChangeNotificationEmail({
    action: params.action,
    actorLabel: params.actorLabel,
    eventName: params.eventName,
    eventAdminUrl: `${getSiteUrl()}/protected/admin/events/${params.eventId}`,
    diff: params.diff,
    reason: params.reason,
  });

  const response = await resend.emails.send({
    from: FROM_ADDRESS,
    to: recipients,
    replyTo: REPLY_TO,
    subject,
    html,
    text,
  });
  console.log(
    `[admin-notify] event ${params.eventId} (${params.action}): Resend response`,
    JSON.stringify(response),
  );
  if (response.error) {
    throw new Error(response.error.message);
  }
}

/** Pre-event reminder (no .ics). Throws on failure — the cron caller catches
 * per participant so one bad send doesn't stop the batch. */
export async function sendReminderEmail({
  event,
  toEmail,
  kind,
}: {
  event: RsvpEmailEvent;
  toEmail: string;
  kind: ReminderKind;
}): Promise<void> {
  const resend = getResendClient();
  const { subject, html, text } = reminderEmail(buildEventInfo(event), kind);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    replyTo: REPLY_TO,
    subject,
    html,
    text,
  });
  if (error) {
    throw new Error(error.message);
  }
}
