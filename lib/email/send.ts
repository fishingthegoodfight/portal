import nodemailer from "nodemailer";
import { Resend } from "resend";

import { formatEventDateRange, formatEventInstant } from "@/lib/format-date";
import { getSiteUrl } from "@/lib/site-url";
import { buildEventIcs, buildGoogleCalendarLink } from "@/lib/email/ics";
import {
  adminChangeNotificationEmail,
  cancellationEmail,
  confirmationEmail,
  eventCancellationEmail,
  eventRestoredEmail,
  eventUpdateEmail,
  leadParticipantCancelledEmail,
  reminderEmail,
  volunteerInviteEmail,
  waitlistOfferEmail,
  waitlistOfferExpiredEmail,
  type ReminderKind,
  type EventChangeDiffEntry,
  type EventChangeAction,
  type RsvpEmailEventInfo,
} from "@/lib/email/templates";

type EmailProvider = "resend" | "smtp";

// Defaults to a resend.dev test sender so this works before the org's
// domain is verified with Resend. The SMTP path uses EMAIL_FROM instead.
const RESEND_FROM_ADDRESS =
  process.env.RESEND_FROM || "Fishing the Good Fight <onboarding@resend.dev>";
const REPLY_TO = "tcramer@fishingthegoodfight.org";

type OutgoingEmail = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /** `content` is base64-encoded. */
  attachments?: { filename: string; content: string; contentType: string }[];
};

function getEmailProvider(): EmailProvider {
  const provider = (process.env.EMAIL_PROVIDER || "resend").trim().toLowerCase();
  if (provider !== "resend" && provider !== "smtp") {
    throw new Error(`EMAIL_PROVIDER must be "resend" or "smtp" (got "${provider}")`);
  }
  return provider;
}

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }
  return new Resend(apiKey);
}

function getSmtpTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  if (!host) {
    throw new Error("SMTP_HOST is not set");
  }
  if (!process.env.EMAIL_FROM) {
    throw new Error("EMAIL_FROM is not set");
  }
  const user = process.env.SMTP_USER;
  return nodemailer.createTransport({
    host,
    port,
    // Implicit TLS on 465; other ports upgrade via STARTTLS when offered.
    secure: port === 465,
    auth: user ? { user, pass: process.env.SMTP_PASS ?? "" } : undefined,
  });
}

/** Single send path for every email — picks the transport from
 * EMAIL_PROVIDER. Throws on failure on either transport. */
async function deliverEmail(email: OutgoingEmail): Promise<void> {
  if (getEmailProvider() === "smtp") {
    await getSmtpTransport().sendMail({
      from: process.env.EMAIL_FROM,
      to: email.to,
      replyTo: REPLY_TO,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: email.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        encoding: "base64",
        contentType: a.contentType,
      })),
    });
    return;
  }

  const { error } = await getResendClient().emails.send({
    from: RESEND_FROM_ADDRESS,
    to: email.to,
    replyTo: REPLY_TO,
    subject: email.subject,
    html: email.html,
    text: email.text,
    attachments: email.attachments,
  });
  if (error) {
    throw new Error(error.message);
  }
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
  /** Public, shown site-wide (events list, event page) as well as in the
   * confirmation and both reminder emails — distinct from custom_email_note
   * above (email-only). No confirmed-RSVP gate, unlike virtual_link below:
   * it's already public everywhere else this event appears. */
  occurrence_note: string | null;
  /** Zoom/meeting link + access notes (passcode, dial-in, etc.) — shown only
   * to someone with a confirmed RSVP, never publicly, and never to a
   * waitlisted or offered person. Every send function below decides whether
   * to surface these via the `includeVirtual` argument to buildEventInfo /
   * buildIcsAttachment; the raw column values are otherwise unused. */
  virtual_link: string | null;
  virtual_access_notes: string | null;
  /** events.ics_sequence as of the write that triggered this send — the
   * caller is responsible for bumping and persisting it first when the
   * calendar entry actually changed (date/time/location edit, or a
   * cancellation); a plain new RSVP confirmation just reads it as-is. */
  ics_sequence: number;
};

function buildEventInfo(event: RsvpEmailEvent, includeVirtual: boolean): RsvpEmailEventInfo {
  const virtualLink = includeVirtual ? event.virtual_link : null;
  const virtualAccessNotes = includeVirtual ? event.virtual_access_notes : null;
  const icsEvent = {
    id: event.id,
    name: event.name,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    timezone: event.timezone,
    location: event.location,
    virtualLink,
    virtualAccessNotes,
  };

  return {
    name: event.name,
    dateRange: formatEventDateRange(event.starts_at, event.ends_at, event.timezone),
    location: event.location,
    leadName: event.lead_name,
    leadPhone: event.lead_phone,
    leadEmail: event.lead_email,
    customNote: event.custom_email_note,
    occurrenceNote: event.occurrence_note,
    eventUrl: `${getSiteUrl()}/protected/events/${event.id}/rsvp`,
    googleCalendarUrl: buildGoogleCalendarLink(icsEvent),
    virtualLink,
    virtualAccessNotes,
  };
}

function buildIcsAttachment(
  event: RsvpEmailEvent,
  method: "REQUEST" | "CANCEL",
  includeVirtual: boolean,
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
      virtualLink: includeVirtual ? event.virtual_link : null,
      virtualAccessNotes: includeVirtual ? event.virtual_access_notes : null,
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
  // Virtual details are for a confirmed RSVP only — never for waitlisted.
  const includeVirtual = status === "confirmed";
  const info = buildEventInfo(event, includeVirtual);
  const { subject, html, text } = confirmationEmail(info, status);

  await deliverEmail({
    to: toEmail,
    subject,
    html,
    text,
    attachments: [buildIcsAttachment(event, "REQUEST", includeVirtual)],
  });
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
  const info = buildEventInfo(event, false);
  const { subject, html, text } = cancellationEmail(info);

  await deliverEmail({
    to: toEmail,
    subject,
    html,
    text,
    attachments: [buildIcsAttachment(event, "CANCEL", false)],
  });
}

/**
 * Renders (without sending) the event cancellation email so the admin
 * cancel flow can show an exact preview before requiring confirmation.
 */
export function previewEventCancellationEmail(event: RsvpEmailEvent, reason: string) {
  return eventCancellationEmail(buildEventInfo(event, false), reason);
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
  const info = buildEventInfo(event, false);
  const { subject, html, text } = eventCancellationEmail(info, reason);

  await deliverEmail({
    to: toEmail,
    subject,
    html,
    text,
    attachments: [buildIcsAttachment(event, "CANCEL", false)],
  });
}

/**
 * Sent to confirmed attendees when an admin edit changes the date, time, or
 * location and the admin opts to notify them. Carries a revised
 * METHOD:REQUEST .ics at the bumped `event.ics_sequence` — including an
 * updated meeting link if that's what changed (every recipient here already
 * holds a confirmed RSVP, per confirmedAttendees in lib/actions/admin-event.ts).
 */
export async function sendEventUpdateEmail({
  event,
  toEmail,
  newWaiverStateName,
}: {
  event: RsvpEmailEvent;
  toEmail: string;
  /** Set when the update switched the event to another state's waiver and
   * this attendee still has to sign it — the email then says so. */
  newWaiverStateName?: string;
}): Promise<void> {
  const info = buildEventInfo(event, false);
  const { subject, html, text } = eventUpdateEmail(info, { newWaiverStateName });

  await deliverEmail({
    to: toEmail,
    subject,
    html,
    text,
    attachments: [buildIcsAttachment(event, "REQUEST", true)],
  });
}

/**
 * Sent to confirmed attendees when a previously-cancelled event is
 * restored, opted into by the admin. Carries a fresh METHOD:REQUEST .ics at
 * the bumped `event.ics_sequence` (every recipient here holds a confirmed
 * RSVP, per confirmedRsvpEmails in lib/actions/admin-event.ts).
 */
export async function sendEventRestoredEmail({
  event,
  toEmail,
}: {
  event: RsvpEmailEvent;
  toEmail: string;
}): Promise<void> {
  const info = buildEventInfo(event, false);
  const { subject, html, text } = eventRestoredEmail(info);

  await deliverEmail({
    to: toEmail,
    subject,
    html,
    text,
    attachments: [buildIcsAttachment(event, "REQUEST", true)],
  });
}

/**
 * Internal notification fanned out to every address in
 * ADMIN_NOTIFICATION_EMAILS (comma-separated) on every event create, edit,
 * or cancellation — including changes made by someone on that list, and
 * regardless of whether attendees were separately notified. A no-op (not an
 * error) when the env var isn't set.
 *
 * Logs the parsed recipient list and the provider used either way —
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

  const { subject, html, text } = adminChangeNotificationEmail({
    action: params.action,
    actorLabel: params.actorLabel,
    eventName: params.eventName,
    eventAdminUrl: `${getSiteUrl()}/protected/admin/events/${params.eventId}`,
    diff: params.diff,
    reason: params.reason,
  });

  await deliverEmail({
    to: recipients,
    subject,
    html,
    text,
  });
  console.log(
    `[admin-notify] event ${params.eventId} (${params.action}): sent via ${getEmailProvider()}`,
  );
}

/** Pre-event reminder (no .ics). Throws on failure — the cron caller catches
 * per participant so one bad send doesn't stop the batch. Always confirmed
 * RSVPs only (see app/api/cron/reminders/route.ts), so virtual details are
 * always included. */
export async function sendReminderEmail({
  event,
  toEmail,
  kind,
}: {
  event: RsvpEmailEvent;
  toEmail: string;
  kind: ReminderKind;
}): Promise<void> {
  const { subject, html, text } = reminderEmail(buildEventInfo(event, true), kind);

  await deliverEmail({
    to: toEmail,
    subject,
    html,
    text,
  });
}

/**
 * A spot opened up for a waitlisted person. `expiresAt` is the ISO timestamp
 * stored on their rsvp; it's rendered in the event's own timezone. Throws on
 * failure — callers log per recipient so one bad send doesn't stop the rest.
 */
export async function sendWaitlistOfferEmail({
  event,
  toEmail,
  expiresAt,
}: {
  event: RsvpEmailEvent;
  toEmail: string;
  expiresAt: string;
}): Promise<void> {
  const { subject, html, text } = waitlistOfferEmail(
    buildEventInfo(event, false),
    formatEventInstant(expiresAt, event.timezone),
  );
  await deliverEmail({ to: toEmail, subject, html, text });
}

/** A waitlist offer lapsed unclaimed (sent by /api/cron/waitlist). */
export async function sendWaitlistOfferExpiredEmail({
  event,
  toEmail,
  reason,
}: {
  event: RsvpEmailEvent;
  toEmail: string;
  /** "capacity" when the offer went away because an admin lowered capacity
   * (default: it simply lapsed, as the cron reports). */
  reason?: "capacity";
}): Promise<void> {
  const { subject, html, text } = waitlistOfferExpiredEmail(buildEventInfo(event, false), { reason });
  await deliverEmail({ to: toEmail, subject, html, text });
}

/**
 * Sent by the "Invite volunteer" admin action — and its re-send, with the
 * same copy either way. Throws on failure; the caller decides how to
 * surface that (the invite still succeeded in creating the row/account).
 */
export async function sendVolunteerInviteEmail({
  toEmail,
  recipientName,
  actionUrl,
  needsPasswordSetup,
}: {
  toEmail: string;
  recipientName: string | null;
  actionUrl: string;
  needsPasswordSetup: boolean;
}): Promise<void> {
  const { subject, html, text } = volunteerInviteEmail({ recipientName, actionUrl, needsPasswordSetup });
  await deliverEmail({ to: toEmail, subject, html, text });
}

/**
 * Tells the event lead (events.lead_email) a participant cancelled and
 * whether the spot went to someone on the waitlist. A no-op (not an error)
 * when the event has no lead email.
 */
export async function sendLeadParticipantCancelledEmail({
  event,
  cancelledBy,
  offeredTo,
}: {
  event: RsvpEmailEvent;
  cancelledBy: string;
  offeredTo: string[];
}): Promise<void> {
  if (!event.lead_email) return;
  const { subject, html, text } = leadParticipantCancelledEmail({
    eventName: event.name,
    dateRange: formatEventDateRange(event.starts_at, event.ends_at, event.timezone),
    eventAdminUrl: `${getSiteUrl()}/protected/admin/events/${event.id}`,
    cancelledBy,
    offeredTo,
  });
  await deliverEmail({ to: event.lead_email, subject, html, text });
}
