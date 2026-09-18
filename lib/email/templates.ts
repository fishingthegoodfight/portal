/**
 * All RSVP email copy — subject lines, body text, and the HTML wrapper —
 * lives in this one file so it's easy to edit by hand without touching
 * send.ts. Plain and mobile-friendly on purpose: single column, inline
 * styles (email clients strip <style> blocks unreliably), no images.
 */

const ORG_NAME = "Fishing the Good Fight";

export type RsvpEmailEventInfo = {
  name: string;
  /** Pre-formatted in the event's own timezone — see lib/format-date.ts. */
  dateRange: string;
  location: string | null;
  leadName: string | null;
  leadPhone: string | null;
  customNote: string | null;
  eventUrl: string;
  googleCalendarUrl: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlWithLineBreaks(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function wrapHtml(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1917;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:8px;">
            <tr>
              <td style="padding:24px;font-size:15px;line-height:1.5;">
                ${bodyHtml}
                <p style="margin:24px 0 0;font-size:12px;color:#78716c;">${ORG_NAME}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function leadSectionHtml(info: RsvpEmailEventInfo): string {
  if (!info.leadName && !info.leadPhone) return "";
  const contact = [info.leadName, info.leadPhone]
    .filter((v): v is string => Boolean(v))
    .map(escapeHtml)
    .join(" · ");
  return `<p style="margin:0 0 16px;"><strong>Day-of questions?</strong><br>${contact}</p>`;
}

function leadSectionText(info: RsvpEmailEventInfo): string {
  if (!info.leadName && !info.leadPhone) return "";
  const contact = [info.leadName, info.leadPhone].filter(Boolean).join(" · ");
  return `Day-of questions? ${contact}`;
}

export function confirmationEmail(
  info: RsvpEmailEventInfo,
  status: "confirmed" | "waitlisted",
): RenderedEmail {
  const waitlisted = status === "waitlisted";
  const name = escapeHtml(info.name);

  const subject = waitlisted
    ? `You're on the waitlist: ${info.name}`
    : `You're confirmed: ${info.name}`;

  const heading = waitlisted ? "You're on the waitlist" : "You're confirmed!";
  const introHtml = waitlisted
    ? `You're on the waitlist for <strong>${name}</strong>. We'll email you if a spot opens up.`
    : `You're confirmed for <strong>${name}</strong>.`;
  const introText = waitlisted
    ? `You're on the waitlist for ${info.name}. We'll email you if a spot opens up.`
    : `You're confirmed for ${info.name}.`;

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">${heading}</p>`,
      `<p style="margin:0 0 16px;">${introHtml}</p>`,
      `<p style="margin:0 0 4px;"><strong>When:</strong> ${escapeHtml(info.dateRange)}</p>`,
      info.location
        ? `<p style="margin:0 0 16px;"><strong>Where:</strong> ${escapeHtml(info.location)}</p>`
        : "",
      leadSectionHtml(info),
      info.customNote ? `<p style="margin:0 0 16px;">${htmlWithLineBreaks(info.customNote)}</p>` : "",
      `<p style="margin:24px 0 8px;"><a href="${info.eventUrl}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">View event</a></p>`,
      `<p style="margin:8px 0 16px;font-size:13px;"><a href="${info.googleCalendarUrl}" style="color:#166534;">Add to Google Calendar</a></p>`,
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Need to cancel? Visit the event page above and click "Cancel RSVP."</p>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const text = [
    heading,
    "",
    introText,
    "",
    `When: ${info.dateRange}`,
    info.location ? `Where: ${info.location}` : "",
    leadSectionText(info),
    info.customNote ?? "",
    "",
    `Event page: ${info.eventUrl}`,
    `Add to Google Calendar: ${info.googleCalendarUrl}`,
    "",
    `Need to cancel? Visit the event page and click "Cancel RSVP."`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

export function cancellationEmail(info: RsvpEmailEventInfo): RenderedEmail {
  const name = escapeHtml(info.name);
  const subject = `RSVP cancelled: ${info.name}`;

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">Your RSVP has been cancelled</p>`,
      `<p style="margin:0 0 16px;">You're no longer registered for <strong>${name}</strong> (${escapeHtml(info.dateRange)}).</p>`,
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Changed your mind? <a href="${info.eventUrl}" style="color:#166534;">RSVP again</a>.</p>`,
    ].join("\n"),
  );

  const text = [
    "Your RSVP has been cancelled",
    "",
    `You're no longer registered for ${info.name} (${info.dateRange}).`,
    "",
    `Changed your mind? RSVP again: ${info.eventUrl}`,
  ].join("\n");

  return { subject, html, text };
}
