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
  leadEmail: string | null;
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
  if (!info.leadName && !info.leadPhone && !info.leadEmail) return "";
  const parts = [
    info.leadName ? escapeHtml(info.leadName) : "",
    info.leadPhone ? escapeHtml(info.leadPhone) : "",
    info.leadEmail
      ? `<a href="mailto:${escapeHtml(info.leadEmail)}" style="color:#166534;">${escapeHtml(info.leadEmail)}</a>`
      : "",
  ].filter(Boolean);
  return `<p style="margin:0 0 16px;"><strong>Day-of questions?</strong><br>${parts.join(" · ")}</p>`;
}

function leadSectionText(info: RsvpEmailEventInfo): string {
  if (!info.leadName && !info.leadPhone && !info.leadEmail) return "";
  const contact = [info.leadName, info.leadPhone, info.leadEmail].filter(Boolean).join(" · ");
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

/**
 * The organizer cancelled the whole event (not a member cancelling their own
 * RSVP — see cancellationEmail above for that). `reason` is always shown,
 * never omitted — the admin cancel form requires one precisely so every
 * confirmed attendee gets a real explanation.
 */
export function eventCancellationEmail(
  info: RsvpEmailEventInfo,
  reason: string,
): RenderedEmail {
  const name = escapeHtml(info.name);
  const subject = `Cancelled: ${info.name}`;
  const whereSuffix = info.location ? ` · ${info.location}` : "";

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">This event has been cancelled</p>`,
      `<p style="margin:0 0 16px;"><strong>${name}</strong> (${escapeHtml(info.dateRange)}${escapeHtml(whereSuffix)}) has been cancelled.</p>`,
      `<p style="margin:0 0 16px;"><strong>Reason:</strong> ${htmlWithLineBreaks(reason)}</p>`,
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Sorry for the inconvenience — we hope to see you at a future event.</p>`,
    ].join("\n"),
  );

  const text = [
    "This event has been cancelled",
    "",
    `${info.name} (${info.dateRange}${whereSuffix}) has been cancelled.`,
    "",
    `Reason: ${reason}`,
    "",
    "Sorry for the inconvenience — we hope to see you at a future event.",
  ].join("\n");

  return { subject, html, text };
}

/**
 * Sent to confirmed attendees when an edit changes the date, time, or
 * location. Carries a revised .ics (same UID, bumped SEQUENCE — see
 * lib/email/ics.ts) so the attendee's existing calendar entry updates in
 * place instead of duplicating.
 */
export function eventUpdateEmail(info: RsvpEmailEventInfo): RenderedEmail {
  const name = escapeHtml(info.name);
  const subject = `Updated: ${info.name}`;

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">This event has been updated</p>`,
      `<p style="margin:0 0 16px;">The date, time, or location changed for <strong>${name}</strong>. Updated details below — please review.</p>`,
      `<p style="margin:0 0 4px;"><strong>When:</strong> ${escapeHtml(info.dateRange)}</p>`,
      info.location
        ? `<p style="margin:0 0 16px;"><strong>Where:</strong> ${escapeHtml(info.location)}</p>`
        : "",
      leadSectionHtml(info),
      `<p style="margin:24px 0 8px;"><a href="${info.eventUrl}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">View event</a></p>`,
      `<p style="margin:8px 0 16px;font-size:13px;"><a href="${info.googleCalendarUrl}" style="color:#166534;">Add to Google Calendar</a></p>`,
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">A calendar update is attached so your existing invite refreshes instead of duplicating.</p>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const text = [
    "This event has been updated",
    "",
    `The date, time, or location changed for ${info.name}. Updated details below — please review.`,
    "",
    `When: ${info.dateRange}`,
    info.location ? `Where: ${info.location}` : "",
    leadSectionText(info),
    "",
    `Event page: ${info.eventUrl}`,
    `Add to Google Calendar: ${info.googleCalendarUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

/**
 * Sent to confirmed attendees when a previously-cancelled event is
 * restored. Carries a fresh METHOD:REQUEST .ics at the bumped
 * `ics_sequence` so it reappears on the calendars it was cleared from.
 */
export function eventRestoredEmail(info: RsvpEmailEventInfo): RenderedEmail {
  const name = escapeHtml(info.name);
  const subject = `Back on: ${info.name}`;

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">This event is back on!</p>`,
      `<p style="margin:0 0 16px;">Good news — <strong>${name}</strong> is happening after all. Details below.</p>`,
      `<p style="margin:0 0 4px;"><strong>When:</strong> ${escapeHtml(info.dateRange)}</p>`,
      info.location
        ? `<p style="margin:0 0 16px;"><strong>Where:</strong> ${escapeHtml(info.location)}</p>`
        : "",
      leadSectionHtml(info),
      `<p style="margin:24px 0 8px;"><a href="${info.eventUrl}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">View event</a></p>`,
      `<p style="margin:8px 0 16px;font-size:13px;"><a href="${info.googleCalendarUrl}" style="color:#166534;">Add to Google Calendar</a></p>`,
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">A calendar update is attached so it reappears on your calendar automatically.</p>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const text = [
    "This event is back on!",
    "",
    `Good news — ${info.name} is happening after all. Details below.`,
    "",
    `When: ${info.dateRange}`,
    info.location ? `Where: ${info.location}` : "",
    leadSectionText(info),
    "",
    `Event page: ${info.eventUrl}`,
    `Add to Google Calendar: ${info.googleCalendarUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

export type EventChangeDiffEntry = {
  label: string;
  before: string;
  after: string;
};

export type EventChangeAction = "created" | "edited" | "cancelled" | "restored";

/**
 * Internal notification to ADMIN_NOTIFICATION_EMAILS — every create, edit,
 * or cancellation, regardless of who made it or whether attendees were also
 * notified. Not attendee-facing, so no .ics attached.
 */
export function adminChangeNotificationEmail({
  action,
  actorLabel,
  eventName,
  eventAdminUrl,
  diff,
  reason,
}: {
  action: EventChangeAction;
  actorLabel: string;
  eventName: string;
  eventAdminUrl: string;
  diff: EventChangeDiffEntry[];
  reason?: string | null;
}): RenderedEmail {
  const subject = `Event ${action}: ${eventName}`;

  const diffRowsHtml = diff
    .map(
      (d) =>
        `<tr><td style="padding:4px 8px 4px 0;font-weight:600;vertical-align:top;white-space:nowrap;">${escapeHtml(d.label)}</td><td style="padding:4px 8px;color:#78716c;vertical-align:top;">${escapeHtml(d.before) || "—"}</td><td style="padding:4px 0;vertical-align:top;">${escapeHtml(d.after) || "—"}</td></tr>`,
    )
    .join("\n");

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">Event ${action}</p>`,
      `<p style="margin:0 0 16px;"><strong>${escapeHtml(actorLabel)}</strong> ${action} <strong>${escapeHtml(eventName)}</strong>.</p>`,
      reason
        ? `<p style="margin:0 0 16px;"><strong>Reason:</strong> ${htmlWithLineBreaks(reason)}</p>`
        : "",
      diff.length > 0
        ? `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:0 0 16px;"><thead><tr><th style="text-align:left;padding:4px 8px 4px 0;">Field</th><th style="text-align:left;padding:4px 8px;">Before</th><th style="text-align:left;padding:4px 0;">After</th></tr></thead><tbody>${diffRowsHtml}</tbody></table>`
        : "",
      `<p style="margin:16px 0 0;font-size:13px;"><a href="${eventAdminUrl}" style="color:#166534;">View event</a></p>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const text = [
    `Event ${action}`,
    "",
    `${actorLabel} ${action} ${eventName}.`,
    reason ? `Reason: ${reason}` : "",
    "",
    ...diff.map((d) => `${d.label}: ${d.before || "—"} -> ${d.after || "—"}`),
    "",
    `View event: ${eventAdminUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

export type ReminderKind = "1week" | "1day";

/**
 * Pre-event reminder, sent a week out and again the day before. No .ics — the
 * confirmation email already carried it.
 */
export function reminderEmail(info: RsvpEmailEventInfo, kind: ReminderKind): RenderedEmail {
  const name = escapeHtml(info.name);
  const when = kind === "1week" ? "one week from now" : "tomorrow";
  const subject =
    kind === "1week" ? `One week away: ${info.name}` : `Tomorrow: ${info.name}`;
  const heading = kind === "1week" ? "See you in a week!" : "See you tomorrow!";

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">${heading}</p>`,
      `<p style="margin:0 0 16px;">A reminder that <strong>${name}</strong> is ${when}.</p>`,
      `<p style="margin:0 0 4px;"><strong>When:</strong> ${escapeHtml(info.dateRange)}</p>`,
      info.location
        ? `<p style="margin:0 0 16px;"><strong>Where:</strong> ${escapeHtml(info.location)}</p>`
        : "",
      leadSectionHtml(info),
      info.customNote ? `<p style="margin:0 0 16px;">${htmlWithLineBreaks(info.customNote)}</p>` : "",
      `<p style="margin:24px 0 8px;"><a href="${info.eventUrl}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">View event</a></p>`,
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Can't make it? Please let us know: visit the event page above and click "Cancel RSVP."</p>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const text = [
    heading,
    "",
    `A reminder that ${info.name} is ${when}.`,
    "",
    `When: ${info.dateRange}`,
    info.location ? `Where: ${info.location}` : "",
    leadSectionText(info),
    info.customNote ?? "",
    "",
    `Event page: ${info.eventUrl}`,
    "",
    `Can't make it? Please let us know: visit the event page and click "Cancel RSVP."`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

/**
 * Sent to the next waitlisted person when a spot opens. The button goes to
 * the event page, where a logged-in "Claim your spot" button confirms them —
 * the offer holds the spot until `expiresLabel` (pre-formatted in the
 * event's timezone).
 */
export function waitlistOfferEmail(info: RsvpEmailEventInfo, expiresLabel: string): RenderedEmail {
  const name = escapeHtml(info.name);
  const subject = `A spot opened up: ${info.name}`;

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">A spot opened up!</p>`,
      `<p style="margin:0 0 16px;">A spot just opened for <strong>${name}</strong>, and you're next on the waitlist. It's being held for you until <strong>${escapeHtml(expiresLabel)}</strong>.</p>`,
      `<p style="margin:0 0 4px;"><strong>When:</strong> ${escapeHtml(info.dateRange)}</p>`,
      info.location
        ? `<p style="margin:0 0 16px;"><strong>Where:</strong> ${escapeHtml(info.location)}</p>`
        : "",
      `<p style="margin:24px 0 8px;"><a href="${info.eventUrl}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">Claim your spot</a></p>`,
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Log in, open the event page, and click "Claim your spot" to confirm. If you don't claim it by ${escapeHtml(expiresLabel)}, it goes to the next person on the waitlist. Can't make it? Click "Decline offer" on the same page so someone else can have it.</p>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const text = [
    "A spot opened up!",
    "",
    `A spot just opened for ${info.name}, and you're next on the waitlist. It's being held for you until ${expiresLabel}.`,
    "",
    `When: ${info.dateRange}`,
    info.location ? `Where: ${info.location}` : "",
    "",
    `Claim your spot: ${info.eventUrl}`,
    "",
    `Log in, open the event page, and click "Claim your spot" to confirm. If you don't claim it by ${expiresLabel}, it goes to the next person on the waitlist. Can't make it? Click "Decline offer" on the same page so someone else can have it.`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

/** Sent when a waitlist offer lapses unclaimed. */
export function waitlistOfferExpiredEmail(info: RsvpEmailEventInfo): RenderedEmail {
  const name = escapeHtml(info.name);
  const subject = `Your spot offer lapsed: ${info.name}`;

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">Your spot offer has lapsed</p>`,
      `<p style="margin:0 0 16px;">The spot we were holding for you at <strong>${name}</strong> (${escapeHtml(info.dateRange)}) wasn't claimed in time, so it's been offered to the next person on the waitlist. You're no longer on the waitlist.</p>`,
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Still want to come? You can <a href="${info.eventUrl}" style="color:#166534;">join the waitlist again</a> — you'll go to the back of the line.</p>`,
    ].join("\n"),
  );

  const text = [
    "Your spot offer has lapsed",
    "",
    `The spot we were holding for you at ${info.name} (${info.dateRange}) wasn't claimed in time, so it's been offered to the next person on the waitlist. You're no longer on the waitlist.`,
    "",
    `Still want to come? Join the waitlist again (you'll go to the back of the line): ${info.eventUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/**
 * Internal heads-up to an event's lead (lead_email) when a participant
 * cancels their confirmed RSVP: who cancelled, and whether the freed spot
 * went to someone on the waitlist.
 */
export function leadParticipantCancelledEmail({
  eventName,
  dateRange,
  eventAdminUrl,
  cancelledBy,
  offeredTo,
}: {
  eventName: string;
  dateRange: string;
  eventAdminUrl: string;
  /** "First Last <email>" — see actorLabel in lib/admin/require-admin.ts. */
  cancelledBy: string;
  /** Labels of the people the freed spot was offered to (empty = nobody was
   * waiting, so it's simply open). */
  offeredTo: string[];
}): RenderedEmail {
  const subject = `RSVP cancelled: ${eventName}`;
  const spotHtml =
    offeredTo.length > 0
      ? `The freed spot was <strong>offered to ${offeredTo.map(escapeHtml).join(", ")}</strong> from the waitlist (24 hours to claim).`
      : `The spot was <strong>not offered to anyone</strong> — nobody was waiting, so it's open.`;
  const spotText =
    offeredTo.length > 0
      ? `The freed spot was offered to ${offeredTo.join(", ")} from the waitlist (24 hours to claim).`
      : "The spot was not offered to anyone — nobody was waiting, so it's open.";

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">A participant cancelled</p>`,
      `<p style="margin:0 0 16px;"><strong>${escapeHtml(cancelledBy)}</strong> cancelled their RSVP for <strong>${escapeHtml(eventName)}</strong> (${escapeHtml(dateRange)}).</p>`,
      `<p style="margin:0 0 16px;">${spotHtml}</p>`,
      `<p style="margin:16px 0 0;font-size:13px;"><a href="${eventAdminUrl}" style="color:#166534;">View roster and waitlist</a></p>`,
    ].join("\n"),
  );

  const text = [
    "A participant cancelled",
    "",
    `${cancelledBy} cancelled their RSVP for ${eventName} (${dateRange}).`,
    "",
    spotText,
    "",
    `View roster and waitlist: ${eventAdminUrl}`,
  ].join("\n");

  return { subject, html, text };
}
