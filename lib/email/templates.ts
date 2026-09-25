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
  /** Public per-occurrence note (events.occurrence_note) — distinct from
   * customNote above (email-only). Rendered only by confirmationEmail and
   * reminderEmail. */
  occurrenceNote: string | null;
  eventUrl: string;
  googleCalendarUrl: string;
  /** Only ever set by the caller (lib/email/send.ts) for someone with a
   * confirmed RSVP — never for waitlisted/offered. Rendered only by
   * confirmationEmail and reminderEmail; see the "Include them in" bullet
   * this was built for. */
  virtualLink: string | null;
  virtualAccessNotes: string | null;
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

/** The event lead's contact details — the "Day-of questions?" block shared by
 * participant and volunteer emails. */
type LeadContact = Pick<RsvpEmailEventInfo, "leadName" | "leadPhone" | "leadEmail">;

function leadSectionHtml(info: LeadContact): string {
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

function leadSectionText(info: LeadContact): string {
  if (!info.leadName && !info.leadPhone && !info.leadEmail) return "";
  const contact = [info.leadName, info.leadPhone, info.leadEmail].filter(Boolean).join(" · ");
  return `Day-of questions? ${contact}`;
}

function virtualSectionHtml(info: RsvpEmailEventInfo): string {
  if (!info.virtualLink) return "";
  return [
    `<p style="margin:0 0 4px;"><strong>Join online:</strong> <a href="${escapeHtml(info.virtualLink)}" style="color:#166534;">${escapeHtml(info.virtualLink)}</a></p>`,
    info.virtualAccessNotes
      ? `<p style="margin:0 0 16px;">${htmlWithLineBreaks(info.virtualAccessNotes)}</p>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function virtualSectionText(info: RsvpEmailEventInfo): string {
  if (!info.virtualLink) return "";
  return [`Join online: ${info.virtualLink}`, info.virtualAccessNotes ?? ""]
    .filter(Boolean)
    .join("\n");
}

/** Visually distinct from the plain paragraphs around it (a tinted box),
 * matching how the site shows it apart from the event's standing
 * description — see EventCard/the RSVP page. */
function occurrenceNoteSectionHtml(info: RsvpEmailEventInfo): string {
  if (!info.occurrenceNote) return "";
  return `<p style="margin:0 0 16px;padding:10px 12px;border-left:3px solid #166534;background:#f0fdf4;">${htmlWithLineBreaks(info.occurrenceNote)}</p>`;
}

function occurrenceNoteSectionText(info: RsvpEmailEventInfo): string {
  return info.occurrenceNote ? `Note: ${info.occurrenceNote}` : "";
}

/*
 * Calendar lines. These deliberately promise no automation, because none is
 * reliable: Gmail only offers an "Add to calendar" prompt for the attached
 * .ics; the Google Calendar link creates a separate entry that nothing can
 * change or remove remotely; and most clients ignore a cancellation .ics from
 * a third-party sender (Outlook honors it, so it's still attached — but never
 * mentioned). So: adding says how to add it, and a cancellation just asks
 * them to delete it themselves if they'd added it.
 */

/** "<lead> open the attached event.ics file, or use Add to Google Calendar." */
function calendarAddHtml(lead: string, googleCalendarUrl: string, file: string): string {
  return `<p style="margin:8px 0 16px;font-size:13px;color:#57534e;">${escapeHtml(lead)} open the attached <strong>${escapeHtml(file)}</strong> file, or use <a href="${googleCalendarUrl}" style="color:#166534;">Add to Google Calendar</a>.</p>`;
}

function calendarAddText(lead: string, googleCalendarUrl: string, file: string): string {
  return `${lead} open the attached ${file} file, or use Add to Google Calendar: ${googleCalendarUrl}`;
}

/** "If you added this event to your calendar, please delete it." */
function calendarDeleteHtml(what: string): string {
  return `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">If you added ${escapeHtml(what)} to your calendar, please delete it.</p>`;
}

function calendarDeleteText(what: string): string {
  return `If you added ${what} to your calendar, please delete it.`;
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
      virtualSectionHtml(info),
      occurrenceNoteSectionHtml(info),
      leadSectionHtml(info),
      info.customNote ? `<p style="margin:0 0 16px;">${htmlWithLineBreaks(info.customNote)}</p>` : "",
      `<p style="margin:24px 0 8px;"><a href="${info.eventUrl}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">View event</a></p>`,
      calendarAddHtml("To add it to your calendar,", info.googleCalendarUrl, "event.ics"),
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
    virtualSectionText(info),
    occurrenceNoteSectionText(info),
    leadSectionText(info),
    info.customNote ?? "",
    "",
    `Event page: ${info.eventUrl}`,
    calendarAddText("To add it to your calendar,", info.googleCalendarUrl, "event.ics"),
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
      calendarDeleteHtml("this event"),
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Changed your mind? <a href="${info.eventUrl}" style="color:#166534;">RSVP again</a>.</p>`,
    ].join("\n"),
  );

  const text = [
    "Your RSVP has been cancelled",
    "",
    `You're no longer registered for ${info.name} (${info.dateRange}).`,
    "",
    calendarDeleteText("this event"),
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
      calendarDeleteHtml("this event"),
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
    calendarDeleteText("this event"),
    "",
    "Sorry for the inconvenience — we hope to see you at a future event.",
  ].join("\n");

  return { subject, html, text };
}

/**
 * Sent to confirmed attendees when an edit changes the date, time, or
 * location. Carries a revised .ics (same UID, bumped SEQUENCE — see
 * lib/email/ics.ts), which clients that process updates apply in place; the
 * copy doesn't rely on that (see the calendar lines above).
 */
export function eventUpdateEmail(
  info: RsvpEmailEventInfo,
  options: {
    /** Set (e.g. "Georgia") when the update moved the event to a different
     * state's liability waiver and this attendee hasn't signed the new one. */
    newWaiverStateName?: string;
  } = {},
): RenderedEmail {
  const name = escapeHtml(info.name);
  const subject = `Updated: ${info.name}`;
  const waiverState = options.newWaiverStateName;

  const introHtml = waiverState
    ? `Details changed for <strong>${name}</strong>, including which liability waiver applies. Updated details below — please review.`
    : `The date, time, or location changed for <strong>${name}</strong>. Updated details below — please review.`;
  const introText = waiverState
    ? `Details changed for ${info.name}, including which liability waiver applies. Updated details below — please review.`
    : `The date, time, or location changed for ${info.name}. Updated details below — please review.`;

  const waiverHtml = waiverState
    ? `<p style="margin:0 0 16px;padding:12px;border:1px solid #f59e0b;border-radius:6px;background:#fffbeb;"><strong>Action needed: sign a new waiver.</strong> This event is now under the ${escapeHtml(waiverState)} liability waiver, so you need to sign the ${escapeHtml(waiverState)} waiver before the event. Your spot is still yours — open the event page, read the waiver, and sign it.</p>`
    : "";
  const waiverText = waiverState
    ? `ACTION NEEDED: sign a new waiver. This event is now under the ${waiverState} liability waiver, so you need to sign the ${waiverState} waiver before the event. Your spot is still yours — open the event page, read the waiver, and sign it: ${info.eventUrl}`
    : "";
  const buttonLabel = waiverState ? "Sign the waiver" : "View event";

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">This event has been updated</p>`,
      `<p style="margin:0 0 16px;">${introHtml}</p>`,
      waiverHtml,
      `<p style="margin:0 0 4px;"><strong>When:</strong> ${escapeHtml(info.dateRange)}</p>`,
      info.location
        ? `<p style="margin:0 0 16px;"><strong>Where:</strong> ${escapeHtml(info.location)}</p>`
        : "",
      leadSectionHtml(info),
      `<p style="margin:24px 0 8px;"><a href="${info.eventUrl}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">${buttonLabel}</a></p>`,
      calendarAddHtml(
        "If it's on your calendar, delete the old entry and add the updated one:",
        info.googleCalendarUrl,
        "event.ics",
      ),
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const text = [
    "This event has been updated",
    "",
    introText,
    "",
    waiverText,
    `When: ${info.dateRange}`,
    info.location ? `Where: ${info.location}` : "",
    leadSectionText(info),
    "",
    `Event page: ${info.eventUrl}`,
    calendarAddText(
      "If it's on your calendar, delete the old entry and add the updated one:",
      info.googleCalendarUrl,
      "event.ics",
    ),
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

/**
 * Sent to confirmed attendees when a previously-cancelled event is
 * restored. Carries a fresh METHOD:REQUEST .ics at the bumped
 * `ics_sequence`, for adding it back.
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
      calendarAddHtml(
        "If you'd removed it from your calendar, add it back:",
        info.googleCalendarUrl,
        "event.ics",
      ),
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
    calendarAddText(
      "If you'd removed it from your calendar, add it back:",
      info.googleCalendarUrl,
      "event.ics",
    ),
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

export type EventChangeAction = "created" | "edited" | "cancelled" | "restored" | "deleted";

/**
 * Internal notification to ADMIN_NOTIFICATION_EMAILS — every create, edit,
 * or cancellation, regardless of who made it or whether attendees were also
 * notified. Not attendee-facing, so no .ics attached.
 */
export function adminChangeNotificationEmail({
  action,
  actorLabel,
  eventName,
  chapter = null,
  eventAdminUrl,
  diff,
  reason,
}: {
  action: EventChangeAction;
  actorLabel: string;
  eventName: string;
  /** "Denver" → "Denver chapter"; "Virtual" stays "Virtual". */
  chapter?: string | null;
  eventAdminUrl: string;
  diff: EventChangeDiffEntry[];
  reason?: string | null;
}): RenderedEmail {
  const chapterLabel = chapter ? (chapter === "Virtual" ? "Virtual" : `${chapter} chapter`) : null;
  const subject = `Event ${action}: ${eventName}${chapterLabel ? ` (${chapterLabel})` : ""}`;

  const diffRowsHtml = diff
    .map(
      (d) =>
        `<tr><td style="padding:4px 8px 4px 0;font-weight:600;vertical-align:top;white-space:nowrap;">${escapeHtml(d.label)}</td><td style="padding:4px 8px;color:#78716c;vertical-align:top;">${escapeHtml(d.before) || "—"}</td><td style="padding:4px 0;vertical-align:top;">${escapeHtml(d.after) || "—"}</td></tr>`,
    )
    .join("\n");

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">Event ${action}</p>`,
      `<p style="margin:0 0 16px;"><strong>${escapeHtml(actorLabel)}</strong> ${action} <strong>${escapeHtml(eventName)}</strong>${chapterLabel ? ` — ${escapeHtml(chapterLabel)}` : ""}.</p>`,
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
    `${actorLabel} ${action} ${eventName}${chapterLabel ? ` — ${chapterLabel}` : ""}.`,
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
      virtualSectionHtml(info),
      occurrenceNoteSectionHtml(info),
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
    virtualSectionText(info),
    occurrenceNoteSectionText(info),
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

/**
 * Sent when a waitlist offer lapses unclaimed (the hourly cron), or — with
 * `reason: "capacity"` — when an admin lowered the event's capacity and the
 * offered spot no longer exists. The capacity variant doesn't claim the spot
 * went to the next person (it didn't; there is no spot) and tells them
 * they're back on the waitlist in their original place.
 */
export function waitlistOfferExpiredEmail(
  info: RsvpEmailEventInfo,
  options: { reason?: "capacity" } = {},
): RenderedEmail {
  if (options.reason === "capacity") return waitlistSpotRemovedEmail(info);

  const name = escapeHtml(info.name);
  const subject = `Your spot offer lapsed: ${info.name}`;

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">Your spot offer has lapsed</p>`,
      `<p style="margin:0 0 16px;">The spot we were holding for you at <strong>${name}</strong> (${escapeHtml(info.dateRange)}) wasn't claimed in time, so it's been offered to the next person on the waitlist. You're no longer on the waitlist.</p>`,
      calendarDeleteHtml("this event"),
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Still want to come? You can <a href="${info.eventUrl}" style="color:#166534;">join the waitlist again</a> — you'll go to the back of the line.</p>`,
    ].join("\n"),
  );

  const text = [
    "Your spot offer has lapsed",
    "",
    `The spot we were holding for you at ${info.name} (${info.dateRange}) wasn't claimed in time, so it's been offered to the next person on the waitlist. You're no longer on the waitlist.`,
    "",
    calendarDeleteText("this event"),
    "",
    `Still want to come? Join the waitlist again (you'll go to the back of the line): ${info.eventUrl}`,
  ].join("\n");

  return { subject, html, text };
}

function waitlistSpotRemovedEmail(info: RsvpEmailEventInfo): RenderedEmail {
  const name = escapeHtml(info.name);
  const subject = `Your spot is no longer available: ${info.name}`;

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">Your spot is no longer available</p>`,
      `<p style="margin:0 0 16px;">The capacity for <strong>${name}</strong> (${escapeHtml(info.dateRange)}) was reduced, so the spot we were holding for you is no longer available.</p>`,
      `<p style="margin:0 0 16px;">You're back on the waitlist, in your original place, and we'll email you if a spot opens up.</p>`,
      `<p style="margin:0 0 16px;font-size:13px;color:#57534e;">If you added this event to your calendar, you don't have a confirmed spot yet — you may want to delete it until one opens up.</p>`,
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Don't want to stay on the waitlist? Open the <a href="${info.eventUrl}" style="color:#166534;">event page</a> and click "Leave waitlist."</p>`,
    ].join("\n"),
  );

  const text = [
    "Your spot is no longer available",
    "",
    `The capacity for ${info.name} (${info.dateRange}) was reduced, so the spot we were holding for you is no longer available.`,
    "",
    "You're back on the waitlist, in your original place, and we'll email you if a spot opens up.",
    "",
    "If you added this event to your calendar, you don't have a confirmed spot yet — you may want to delete it until one opens up.",
    "",
    `Don't want to stay on the waitlist? Open the event page and click "Leave waitlist": ${info.eventUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/**
 * Sent when an admin invites someone to the volunteer registry — including a
 * re-send, which uses the same copy. `actionUrl` is either a Supabase invite
 * link (brand-new account, sets a password on first click) or a plain link
 * to the registration form (existing account — they just log in as usual).
 */
export function volunteerInviteEmail({
  recipientName,
  actionUrl,
  needsPasswordSetup,
}: {
  recipientName: string | null;
  actionUrl: string;
  /** True whenever the link needs to take them through setting a password
   * first — a brand-new account, or an earlier invite they never completed —
   * before landing on the registration form. False only for someone who
   * already has a working (password-set) account. */
  needsPasswordSetup: boolean;
}): RenderedEmail {
  const subject = "You're invited to volunteer with Fishing the Good Fight";
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : "Hi,";
  const greetingText = recipientName ? `Hi ${recipientName},` : "Hi,";
  const introHtml = needsPasswordSetup
    ? "You've been invited to join the volunteer team. Click below to set up your account and complete your volunteer registration."
    : "You've been invited to join the volunteer team. Click below to complete your volunteer registration.";
  const introText = needsPasswordSetup
    ? "You've been invited to join the volunteer team. Follow the link below to set up your account and complete your volunteer registration."
    : "You've been invited to join the volunteer team. Follow the link below to complete your volunteer registration.";
  const buttonLabel = needsPasswordSetup ? "Set up your account" : "Complete registration";

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">You're invited to volunteer</p>`,
      `<p style="margin:0 0 16px;">${greeting}</p>`,
      `<p style="margin:0 0 16px;">${introHtml}</p>`,
      `<p style="margin:24px 0 8px;"><a href="${actionUrl}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">${buttonLabel}</a></p>`,
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Questions? Just reply to this email.</p>`,
    ].join("\n"),
  );

  const text = [
    "You're invited to volunteer",
    "",
    greetingText,
    "",
    introText,
    "",
    `${buttonLabel}: ${actionUrl}`,
    "",
    "Questions? Just reply to this email.",
  ].join("\n");

  return { subject, html, text };
}

/**
 * An invite to the portal itself — staff, board members, anyone who needs an
 * account but isn't joining the volunteer team (that's volunteerInviteEmail).
 * The link sets a password, then lands on their profile.
 */
export function personInviteEmail({
  recipientName,
  actionUrl,
}: {
  recipientName: string | null;
  actionUrl: string;
}): RenderedEmail {
  const subject = "You're invited to the Fishing the Good Fight portal";
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : "Hi,";
  const greetingText = recipientName ? `Hi ${recipientName},` : "Hi,";
  const intro =
    "You've been given an account on the Fishing the Good Fight portal. Click below to set your password and check your contact details.";
  const buttonLabel = "Set up your account";

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">You're invited to the portal</p>`,
      `<p style="margin:0 0 16px;">${greeting}</p>`,
      `<p style="margin:0 0 16px;">${intro}</p>`,
      `<p style="margin:24px 0 8px;"><a href="${actionUrl}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">${buttonLabel}</a></p>`,
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Questions? Just reply to this email.</p>`,
    ].join("\n"),
  );

  const text = [
    "You're invited to the portal",
    "",
    greetingText,
    "",
    intro,
    "",
    `${buttonLabel}: ${actionUrl}`,
    "",
    "Questions? Just reply to this email.",
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

/**
 * What a volunteer shift email (confirmation, cancellation, reminder) needs.
 * Distinct from RsvpEmailEventInfo — this is about the SHIFT, not the whole
 * event: shiftDateRange is the role's own shift_start/shift_end, not the
 * event's start/end, and there's no waitlist concept here (no volunteer
 * waitlist yet). The lead contact is the event's, same as participants get.
 */
export type VolunteerShiftEmailInfo = {
  eventName: string;
  role: string;
  /** Pre-formatted in the event's own timezone — see lib/format-date.ts. */
  shiftDateRange: string;
  description: string | null;
  whatToBring: string | null;
  location: string | null;
  /** Always included when set — unlike the participant confirmation, a
   * confirmed volunteer signup is itself the "eligible to see it" gate, no
   * separate RSVP status to check (see lib/email/send.ts). */
  virtualLink: string | null;
  virtualAccessNotes: string | null;
  eventUrl: string;
  googleCalendarUrl: string;
  /** The event lead, for day-of questions — rendered by the confirmation and
   * reminder emails (see leadSectionHtml). */
  leadName: string | null;
  leadPhone: string | null;
  leadEmail: string | null;
};

function volunteerWhereHtml(info: VolunteerShiftEmailInfo): string {
  return [
    info.location
      ? `<p style="margin:0 0 16px;"><strong>Where:</strong> ${escapeHtml(info.location)}</p>`
      : "",
    info.virtualLink
      ? `<p style="margin:0 0 4px;"><strong>Join online:</strong> <a href="${escapeHtml(info.virtualLink)}" style="color:#166534;">${escapeHtml(info.virtualLink)}</a></p>`
      : "",
    info.virtualLink && info.virtualAccessNotes
      ? `<p style="margin:0 0 16px;">${htmlWithLineBreaks(info.virtualAccessNotes)}</p>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function volunteerWhereText(info: VolunteerShiftEmailInfo): string {
  return [
    info.location ? `Where: ${info.location}` : "",
    info.virtualLink ? `Join online: ${info.virtualLink}` : "",
    info.virtualLink ? (info.virtualAccessNotes ?? "") : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Sent when someone signs up for a volunteer shift — carries a
 * METHOD:REQUEST .ics for the SHIFT's own times, not the event's. */
export function volunteerSignupConfirmationEmail(info: VolunteerShiftEmailInfo): RenderedEmail {
  const subject = `You're signed up to volunteer: ${info.role} — ${info.eventName}`;

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">You're signed up to volunteer!</p>`,
      `<p style="margin:0 0 16px;"><strong>${escapeHtml(info.role)}</strong> at <strong>${escapeHtml(info.eventName)}</strong>.</p>`,
      `<p style="margin:0 0 4px;"><strong>Shift:</strong> ${escapeHtml(info.shiftDateRange)}</p>`,
      volunteerWhereHtml(info),
      info.whatToBring
        ? `<p style="margin:0 0 16px;"><strong>What to bring or wear:</strong> ${escapeHtml(info.whatToBring)}</p>`
        : "",
      info.description ? `<p style="margin:0 0 16px;">${htmlWithLineBreaks(info.description)}</p>` : "",
      leadSectionHtml(info),
      `<p style="margin:24px 0 8px;"><a href="${info.eventUrl}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">View event</a></p>`,
      calendarAddHtml("To add your shift to your calendar,", info.googleCalendarUrl, "shift.ics"),
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Can't make it? Visit the event page above and cancel your volunteer signup.</p>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const text = [
    "You're signed up to volunteer!",
    "",
    `${info.role} at ${info.eventName}.`,
    "",
    `Shift: ${info.shiftDateRange}`,
    volunteerWhereText(info),
    info.whatToBring ? `What to bring or wear: ${info.whatToBring}` : "",
    info.description ?? "",
    leadSectionText(info),
    "",
    `Event page: ${info.eventUrl}`,
    calendarAddText("To add your shift to your calendar,", info.googleCalendarUrl, "shift.ics"),
    "",
    "Can't make it? Visit the event page and cancel your volunteer signup.",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

/** Sent when a volunteer cancels their shift signup — carries a
 * METHOD:CANCEL .ics, same UID as the confirmation. */
export function volunteerCancellationEmail(info: VolunteerShiftEmailInfo): RenderedEmail {
  const subject = `Volunteer signup cancelled: ${info.role} — ${info.eventName}`;

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">Your volunteer signup has been cancelled</p>`,
      `<p style="margin:0 0 16px;">You're no longer signed up for <strong>${escapeHtml(info.role)}</strong> at <strong>${escapeHtml(info.eventName)}</strong> (${escapeHtml(info.shiftDateRange)}).</p>`,
      calendarDeleteHtml("this shift"),
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Changed your mind? <a href="${info.eventUrl}" style="color:#166534;">Sign up again</a> if a spot is still open.</p>`,
    ].join("\n"),
  );

  const text = [
    "Your volunteer signup has been cancelled",
    "",
    `You're no longer signed up for ${info.role} at ${info.eventName} (${info.shiftDateRange}).`,
    "",
    calendarDeleteText("this shift"),
    "",
    `Changed your mind? Sign up again if a spot is still open: ${info.eventUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/** Sent when an admin cancels a volunteer role outright (edit form, "Cancel
 * role") — unlike volunteerCancellationEmail, the volunteer didn't choose
 * this, and there's nothing to sign up for again. Carries a METHOD:CANCEL
 * .ics, same UID as the confirmation. */
export function volunteerRoleCancelledEmail(info: VolunteerShiftEmailInfo): RenderedEmail {
  const subject = `Volunteer role cancelled: ${info.role} — ${info.eventName}`;

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">A volunteer role you signed up for was cancelled</p>`,
      `<p style="margin:0 0 16px;">The organizers cancelled <strong>${escapeHtml(info.role)}</strong> at <strong>${escapeHtml(info.eventName)}</strong> (${escapeHtml(info.shiftDateRange)}), so your signup for it has been cancelled. Thank you for offering your time.</p>`,
      calendarDeleteHtml("this shift"),
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">You can see any other open volunteer roles on the <a href="${info.eventUrl}" style="color:#166534;">event page</a>.</p>`,
    ].join("\n"),
  );

  const text = [
    "A volunteer role you signed up for was cancelled",
    "",
    `The organizers cancelled ${info.role} at ${info.eventName} (${info.shiftDateRange}), so your signup for it has been cancelled. Thank you for offering your time.`,
    "",
    calendarDeleteText("this shift"),
    "",
    `Any other open volunteer roles are on the event page: ${info.eventUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/** Sent when the whole EVENT is cancelled (cancelEventAction) to each
 * volunteer whose confirmed shift was cancelled with it — the admin's reason
 * plus a METHOD:CANCEL .ics for the shift, same UID as the confirmation. */
export function volunteerShiftEventCancelledEmail(
  info: VolunteerShiftEmailInfo,
  reason: string,
): RenderedEmail {
  const subject = `Event cancelled: ${info.eventName} — your ${info.role} shift is cancelled`;

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">${escapeHtml(info.eventName)} has been cancelled</p>`,
      `<p style="margin:0 0 16px;">Your volunteer shift as <strong>${escapeHtml(info.role)}</strong> (${escapeHtml(info.shiftDateRange)}) is cancelled along with it — please don't come in for it.</p>`,
      `<p style="margin:0 0 16px;"><strong>Reason:</strong> ${htmlWithLineBreaks(reason)}</p>`,
      calendarDeleteHtml("this shift"),
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Thank you for offering your time.</p>`,
    ].join("\n"),
  );

  const text = [
    `${info.eventName} has been cancelled`,
    "",
    `Your volunteer shift as ${info.role} (${info.shiftDateRange}) is cancelled along with it — please don't come in for it.`,
    "",
    `Reason: ${reason}`,
    "",
    calendarDeleteText("this shift"),
    "",
    "Thank you for offering your time.",
  ].join("\n");

  return { subject, html, text };
}

/** Sent on restoring a cancelled event (restoreEventAction), when the admin
 * chooses to, to the volunteers whose shifts were cancelled with it. Their
 * signups are NOT restored — this tells them it's back on and they can sign
 * up again. No .ics: they aren't signed up for anything yet. */
export function volunteerEventRestoredEmail(info: VolunteerShiftEmailInfo): RenderedEmail {
  const subject = `Back on: ${info.eventName} — sign up again to volunteer`;

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">${escapeHtml(info.eventName)} is back on</p>`,
      `<p style="margin:0 0 16px;">This event was cancelled earlier, which also cancelled your volunteer shift as <strong>${escapeHtml(info.role)}</strong> (${escapeHtml(info.shiftDateRange)}). The event has been restored, but your shift <strong>was not</strong> — you're not signed up for it right now.</p>`,
      `<p style="margin:0 0 16px;">If you can still make it, <a href="${info.eventUrl}" style="color:#166534;">sign up again on the event page</a> while spots are open.</p>`,
    ].join("\n"),
  );

  const text = [
    `${info.eventName} is back on`,
    "",
    `This event was cancelled earlier, which also cancelled your volunteer shift as ${info.role} (${info.shiftDateRange}). The event has been restored, but your shift was NOT — you're not signed up for it right now.`,
    "",
    `If you can still make it, sign up again on the event page while spots are open: ${info.eventUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/**
 * Pre-shift reminder (1 week / 1 day out — same cron pass and window as the
 * participant reminder, a separate email). No .ics — the confirmation
 * already carried it.
 */
export function volunteerReminderEmail(
  info: VolunteerShiftEmailInfo,
  kind: ReminderKind,
): RenderedEmail {
  const when = kind === "1week" ? "one week from now" : "tomorrow";
  const subject =
    kind === "1week"
      ? `Volunteering in one week: ${info.role} — ${info.eventName}`
      : `Volunteering tomorrow: ${info.role} — ${info.eventName}`;
  const heading = kind === "1week" ? "Your volunteer shift is in a week" : "Your volunteer shift is tomorrow";

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">${heading}</p>`,
      `<p style="margin:0 0 16px;">A reminder that you're volunteering as <strong>${escapeHtml(info.role)}</strong> at <strong>${escapeHtml(info.eventName)}</strong> ${when}.</p>`,
      `<p style="margin:0 0 4px;"><strong>Shift:</strong> ${escapeHtml(info.shiftDateRange)}</p>`,
      volunteerWhereHtml(info),
      info.whatToBring
        ? `<p style="margin:0 0 16px;"><strong>What to bring or wear:</strong> ${escapeHtml(info.whatToBring)}</p>`
        : "",
      leadSectionHtml(info),
      `<p style="margin:24px 0 8px;"><a href="${info.eventUrl}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">View event</a></p>`,
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Can't make it? Please let us know: visit the event page above and cancel your volunteer signup.</p>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const text = [
    heading,
    "",
    `A reminder that you're volunteering as ${info.role} at ${info.eventName} ${when}.`,
    "",
    `Shift: ${info.shiftDateRange}`,
    volunteerWhereText(info),
    info.whatToBring ? `What to bring or wear: ${info.whatToBring}` : "",
    leadSectionText(info),
    "",
    `Event page: ${info.eventUrl}`,
    "",
    "Can't make it? Please let us know: visit the event page and cancel your volunteer signup.",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

/**
 * "Switch to volunteering": the one email someone gets after trading their
 * RSVP for a volunteer shift at the same event — in place of both the RSVP
 * cancellation and the volunteer confirmation. Carries the shift's
 * METHOD:REQUEST .ics (and a CANCEL for the event's own calendar entry —
 * see lib/email/send.ts).
 */
export function switchedToVolunteeringEmail(
  info: VolunteerShiftEmailInfo,
  /** The RSVP that was cancelled: 'confirmed' freed a spot; a waitlist place
   * or open offer didn't hold one of their own. */
  previousRsvpStatus: string | null,
): RenderedEmail {
  const subject = `You're volunteering instead: ${info.role} — ${info.eventName}`;
  const rsvpNote =
    previousRsvpStatus === "confirmed"
      ? "Your RSVP to attend has been cancelled, so your spot can go to someone else."
      : previousRsvpStatus === "waitlisted"
        ? "You've been taken off the waitlist to attend."
        : previousRsvpStatus === "offered"
          ? "The spot you were offered to attend has been passed to the next person."
          : "";

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">You're now volunteering</p>`,
      `<p style="margin:0 0 16px;">You're signed up to volunteer as <strong>${escapeHtml(info.role)}</strong> at <strong>${escapeHtml(info.eventName)}</strong>.${rsvpNote ? ` ${escapeHtml(rsvpNote)}` : ""}</p>`,
      `<p style="margin:0 0 4px;"><strong>Shift:</strong> ${escapeHtml(info.shiftDateRange)}</p>`,
      volunteerWhereHtml(info),
      info.whatToBring
        ? `<p style="margin:0 0 16px;"><strong>What to bring or wear:</strong> ${escapeHtml(info.whatToBring)}</p>`
        : "",
      info.description ? `<p style="margin:0 0 16px;">${htmlWithLineBreaks(info.description)}</p>` : "",
      leadSectionHtml(info),
      `<p style="margin:24px 0 8px;"><a href="${info.eventUrl}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">View event</a></p>`,
      calendarAddHtml("To add your shift to your calendar,", info.googleCalendarUrl, "shift.ics"),
      previousRsvpStatus
        ? `<p style="margin:0 0 16px;font-size:13px;color:#57534e;">If you added the event itself to your calendar when you RSVP'd, please delete that entry — your shift is a separate one.</p>`
        : "",
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Can't make it? Visit the event page above and cancel your volunteer signup.</p>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const text = [
    "You're now volunteering",
    "",
    `You're signed up to volunteer as ${info.role} at ${info.eventName}.${rsvpNote ? ` ${rsvpNote}` : ""}`,
    "",
    `Shift: ${info.shiftDateRange}`,
    volunteerWhereText(info),
    info.whatToBring ? `What to bring or wear: ${info.whatToBring}` : "",
    info.description ?? "",
    leadSectionText(info),
    "",
    `Event page: ${info.eventUrl}`,
    calendarAddText("To add your shift to your calendar,", info.googleCalendarUrl, "shift.ics"),
    previousRsvpStatus
      ? "If you added the event itself to your calendar when you RSVP'd, please delete that entry — your shift is a separate one."
      : "",
    "",
    "Can't make it? Visit the event page and cancel your volunteer signup.",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

/**
 * "Switch to attending": the one email someone gets after trading their
 * volunteer shift(s) for a confirmed RSVP at the same event — in place of
 * both the volunteer cancellation and the RSVP confirmation. Same event
 * details as confirmationEmail. `cancelledShifts` are "Role (shift time)".
 */
export function switchedToAttendingEmail(
  info: RsvpEmailEventInfo,
  cancelledShifts: string[],
): RenderedEmail {
  const name = escapeHtml(info.name);
  const subject = `You're attending instead: ${info.name}`;
  const shiftList = cancelledShifts.join(", ");

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">You're now attending</p>`,
      `<p style="margin:0 0 16px;">You're confirmed to attend <strong>${name}</strong>. Your volunteer signup${cancelledShifts.length === 1 ? "" : "s"} (${escapeHtml(shiftList)}) ${cancelledShifts.length === 1 ? "has" : "have"} been cancelled so someone else can take ${cancelledShifts.length === 1 ? "it" : "them"}.</p>`,
      `<p style="margin:0 0 4px;"><strong>When:</strong> ${escapeHtml(info.dateRange)}</p>`,
      info.location
        ? `<p style="margin:0 0 16px;"><strong>Where:</strong> ${escapeHtml(info.location)}</p>`
        : "",
      virtualSectionHtml(info),
      occurrenceNoteSectionHtml(info),
      leadSectionHtml(info),
      info.customNote ? `<p style="margin:0 0 16px;">${htmlWithLineBreaks(info.customNote)}</p>` : "",
      `<p style="margin:24px 0 8px;"><a href="${info.eventUrl}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">View event</a></p>`,
      calendarAddHtml("To add the event to your calendar,", info.googleCalendarUrl, "event.ics"),
      `<p style="margin:0 0 16px;font-size:13px;color:#57534e;">If you added your volunteer ${cancelledShifts.length === 1 ? "shift" : "shifts"} to your calendar, please delete ${cancelledShifts.length === 1 ? "it" : "them"}.</p>`,
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Need to cancel? Visit the event page above and click "Cancel RSVP."</p>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const text = [
    "You're now attending",
    "",
    `You're confirmed to attend ${info.name}. Your volunteer signup${cancelledShifts.length === 1 ? "" : "s"} (${shiftList}) ${cancelledShifts.length === 1 ? "has" : "have"} been cancelled so someone else can take ${cancelledShifts.length === 1 ? "it" : "them"}.`,
    "",
    `When: ${info.dateRange}`,
    info.location ? `Where: ${info.location}` : "",
    virtualSectionText(info),
    occurrenceNoteSectionText(info),
    leadSectionText(info),
    info.customNote ?? "",
    "",
    `Event page: ${info.eventUrl}`,
    calendarAddText("To add the event to your calendar,", info.googleCalendarUrl, "event.ics"),
    `If you added your volunteer ${cancelledShifts.length === 1 ? "shift" : "shifts"} to your calendar, please delete ${cancelledShifts.length === 1 ? "it" : "them"}.`,
    "",
    `Need to cancel? Visit the event page and click "Cancel RSVP."`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

/** Internal heads-up to an event's lead (lead_email) when someone signs up
 * for or cancels a volunteer shift — mirrors leadParticipantCancelledEmail
 * above. `action` selects the copy; a no-op when the event has no lead
 * email is the caller's job (see lib/email/send.ts). */
export function leadVolunteerSignupChangeEmail({
  action,
  volunteerName,
  role,
  eventName,
  shiftDateRange,
  eventAdminUrl,
}: {
  action: "signed_up" | "cancelled";
  /** "First Last <email>" — see actorLabel-style formatting, or just the email. */
  volunteerName: string;
  role: string;
  eventName: string;
  shiftDateRange: string;
  eventAdminUrl: string;
}): RenderedEmail {
  const verb = action === "signed_up" ? "signed up for" : "cancelled";
  const subject =
    action === "signed_up"
      ? `Volunteer signed up: ${role} — ${eventName}`
      : `Volunteer cancelled: ${role} — ${eventName}`;

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">A volunteer ${verb} a shift</p>`,
      `<p style="margin:0 0 16px;"><strong>${escapeHtml(volunteerName)}</strong> ${verb} <strong>${escapeHtml(role)}</strong> at <strong>${escapeHtml(eventName)}</strong> (${escapeHtml(shiftDateRange)}).</p>`,
      `<p style="margin:16px 0 0;font-size:13px;"><a href="${eventAdminUrl}" style="color:#166534;">View event roster</a></p>`,
    ].join("\n"),
  );

  const text = [
    `A volunteer ${verb} a shift`,
    "",
    `${volunteerName} ${verb} ${role} at ${eventName} (${shiftDateRange}).`,
    "",
    `View event roster: ${eventAdminUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/**
 * To a volunteer applicant: "book a call with us" — the screening call, via
 * the scheduling link from Setup (a Google Calendar appointment schedule).
 */
export function applicationInviteToScheduleEmail({
  recipientName,
  schedulingUrl,
}: {
  recipientName: string | null;
  schedulingUrl: string;
}): RenderedEmail {
  const subject = "Let's talk about volunteering with Fishing the Good Fight";
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : "Hi,";
  const greetingText = recipientName ? `Hi ${recipientName},` : "Hi,";
  const intro =
    "Thanks for applying to volunteer with Fishing the Good Fight. The next step is a short call so we can get to know you, answer your questions, and talk about where you'd fit best.";
  const ask = "Pick a time that works for you:";
  const buttonLabel = "Book a call";

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">Let's set up a call</p>`,
      `<p style="margin:0 0 16px;">${greeting}</p>`,
      `<p style="margin:0 0 16px;">${intro}</p>`,
      `<p style="margin:0 0 8px;">${ask}</p>`,
      `<p style="margin:16px 0 8px;"><a href="${escapeHtml(schedulingUrl)}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">${buttonLabel}</a></p>`,
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">If none of the times work, just reply to this email and we'll sort something out.</p>`,
    ].join("\n"),
  );
  const text = [
    "Let's set up a call",
    "",
    greetingText,
    "",
    intro,
    "",
    `${ask} ${schedulingUrl}`,
    "",
    "If none of the times work, just reply to this email and we'll sort something out.",
  ].join("\n");
  return { subject, html, text };
}

/**
 * To a volunteer applicant: we'd like to see you at a few more events before
 * we talk. Warm, and explicitly not a no — the application stays open and
 * picks itself back up once they've been to a few more.
 */
export function applicationAttendMoreEventsEmail({
  recipientName,
  eventsUrl,
}: {
  recipientName: string | null;
  eventsUrl: string;
}): RenderedEmail {
  const subject = "Thanks for applying to volunteer — a quick next step";
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : "Hi,";
  const greetingText = recipientName ? `Hi ${recipientName},` : "Hi,";
  const paragraphs = [
    "Thanks for applying to volunteer with Fishing the Good Fight — we've got your application, and we're really glad you want to be part of this.",
    "Before we sit down and talk, we'd love to see you at a few more of our events. It's how we get to know each other, and it's the best way for you to see what volunteering here actually looks like.",
    "This isn't a no. Your application stays open — you don't need to reapply. Once you've been to a few more events, it comes back to us and we'll reach out about a call.",
  ];
  const buttonLabel = "See upcoming events";

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">We've got your application</p>`,
      `<p style="margin:0 0 16px;">${greeting}</p>`,
      ...paragraphs.map((p) => `<p style="margin:0 0 16px;">${escapeHtml(p)}</p>`),
      `<p style="margin:16px 0 8px;"><a href="${escapeHtml(eventsUrl)}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">${buttonLabel}</a></p>`,
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">Questions? Just reply to this email.</p>`,
    ].join("\n"),
  );
  const text = [
    "We've got your application",
    "",
    greetingText,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    `${buttonLabel}: ${eventsUrl}`,
    "",
    "Questions? Just reply to this email.",
  ].join("\n");
  return { subject, html, text };
}

/** One section of the daily admin digest — e.g. "Applications now ready to
 * screen"; phase 3 adds pending reference checks as another. */
export type AdminDigestSection = {
  title: string;
  /** One line under the title, optional. */
  intro?: string;
  items: { label: string; detail?: string; url: string }[];
};

/**
 * The daily admin digest: everything needing an admin's attention, as
 * sections in priority order. Only sent when at least one section has items.
 */
export function adminDigestEmail({ sections }: { sections: AdminDigestSection[] }): RenderedEmail {
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const subject = `FTGF portal: ${total} ${total === 1 ? "thing needs" : "things need"} your attention`;

  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">Needs your attention</p>`,
      ...sections.map((section) =>
        [
          `<p style="margin:20px 0 4px;font-weight:600;">${escapeHtml(section.title)} (${section.items.length})</p>`,
          section.intro ? `<p style="margin:0 0 8px;font-size:13px;color:#57534e;">${escapeHtml(section.intro)}</p>` : "",
          `<ul style="margin:0;padding-left:20px;">`,
          ...section.items.map(
            (item) =>
              `<li style="margin:0 0 6px;"><a href="${escapeHtml(item.url)}">${escapeHtml(item.label)}</a>${
                item.detail ? ` <span style="color:#57534e;">— ${escapeHtml(item.detail)}</span>` : ""
              }</li>`,
          ),
          `</ul>`,
        ].join("\n"),
      ),
    ].join("\n"),
  );
  const text = [
    "Needs your attention",
    ...sections.flatMap((section) => [
      "",
      `${section.title} (${section.items.length})`,
      ...(section.intro ? [section.intro] : []),
      ...section.items.map((item) => `- ${item.label}${item.detail ? ` — ${item.detail}` : ""}: ${item.url}`),
    ]),
  ].join("\n");
  return { subject, html, text };
}
