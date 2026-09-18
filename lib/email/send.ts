import { Resend } from "resend";

import { formatEventDateRange } from "@/lib/format-date";
import { getSiteUrl } from "@/lib/site-url";
import { buildEventIcs, buildGoogleCalendarLink } from "@/lib/email/ics";
import {
  cancellationEmail,
  confirmationEmail,
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

/** The event columns every RSVP email needs — see the
 * 2026-09-18 schema-changes.sql entry for lead_name/lead_phone/custom_email_note. */
export type RsvpEmailEvent = {
  id: number;
  name: string;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  location: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  custom_email_note: string | null;
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
    customNote: event.custom_email_note,
    eventUrl: `${getSiteUrl()}/protected/events/${event.id}/rsvp`,
    googleCalendarUrl: buildGoogleCalendarLink(icsEvent),
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
  const ics = buildEventIcs({
    method: "REQUEST",
    event: {
      id: event.id,
      name: event.name,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      timezone: event.timezone,
      location: event.location,
    },
  });

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    replyTo: REPLY_TO,
    subject,
    html,
    text,
    attachments: [
      {
        filename: "event.ics",
        content: Buffer.from(ics, "utf-8").toString("base64"),
        contentType: "text/calendar; method=REQUEST; charset=UTF-8",
      },
    ],
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
  const ics = buildEventIcs({
    method: "CANCEL",
    event: {
      id: event.id,
      name: event.name,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      timezone: event.timezone,
      location: event.location,
    },
  });

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    replyTo: REPLY_TO,
    subject,
    html,
    text,
    attachments: [
      {
        filename: "cancel.ics",
        content: Buffer.from(ics, "utf-8").toString("base64"),
        contentType: "text/calendar; method=CANCEL; charset=UTF-8",
      },
    ],
  });
  if (error) {
    throw new Error(error.message);
  }
}
