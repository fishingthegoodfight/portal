import { escapeHtml, wrapHtml, type RenderedEmail } from "@/lib/email/templates";

/**
 * Retreat registration emails: the registration itself, waitlist offers,
 * room request decisions, and the pre-retreat check. Plain and specific:
 * what happened, what (if anything) they need to do, by when.
 */

export type RetreatEmailInfo = {
  /** The person's first name, if known. */
  recipientName: string | null;
  retreatName: string;
  /** "Fri, May 14 · 3:00 PM – Mon, May 17 · 11:00 AM MDT". */
  dateRange: string;
  /** The retreat's page for them (/protected/retreats/[id]). */
  retreatUrl: string;
};

type Block = { text: string; strong?: boolean };

function render(
  info: RetreatEmailInfo,
  subject: string,
  blocks: Block[],
  button: { label: string; url: string } | null,
  footer = "Questions? Just reply to this email.",
): RenderedEmail {
  const greeting = info.recipientName ? `Hi ${info.recipientName},` : "Hi,";
  const html = wrapHtml(
    [
      `<p style="margin:0 0 16px;">${escapeHtml(greeting)}</p>`,
      ...blocks.map(
        (b) => `<p style="margin:0 0 16px;">${b.strong ? `<strong>${escapeHtml(b.text)}</strong>` : escapeHtml(b.text)}</p>`,
      ),
      `<p style="margin:0 0 16px;color:#57534e;">${escapeHtml(info.retreatName)}<br>${escapeHtml(info.dateRange)}</p>`,
      button
        ? `<p style="margin:16px 0 8px;"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">${escapeHtml(button.label)}</a></p>`
        : "",
      `<p style="margin:16px 0 0;font-size:13px;color:#57534e;">${escapeHtml(footer)}</p>`,
    ].join("\n"),
  );
  const text = [
    greeting,
    "",
    ...blocks.flatMap((b) => [b.text, ""]),
    info.retreatName,
    info.dateRange,
    "",
    ...(button ? [`${button.label}: ${button.url}`, ""] : []),
    footer,
  ].join("\n");
  return { subject, html, text };
}

export type RegistrationEmailStatus = "pending_payment" | "waitlisted" | "confirmed";

export function retreatRegistrationEmail(
  info: RetreatEmailInfo,
  status: RegistrationEmailStatus,
  opts: { roomRequested: boolean },
): RenderedEmail {
  const room = opts.roomRequested
    ? [{ text: "We've got your request for your own room. We'll email you once it's been reviewed." }]
    : [];
  if (status === "confirmed") {
    return render(
      info,
      `You're confirmed: ${info.retreatName}`,
      [{ text: `You're confirmed for ${info.retreatName}. We're glad you're coming.`, strong: true }, ...room,
        { text: "Where we're staying and fishing, and the links for any calls before the retreat, are on your retreat page." }],
      { label: "See your retreat page", url: info.retreatUrl },
    );
  }
  if (status === "waitlisted") {
    return render(
      info,
      `You're on the waitlist: ${info.retreatName}`,
      [{ text: `${info.retreatName} is full right now, so you're on the waitlist. You haven't been charged anything.`, strong: true },
        { text: "If a spot opens up, we'll email you an offer with a deadline to take it." }, ...room],
      { label: "See your registration", url: info.retreatUrl },
    );
  }
  return render(
    info,
    `Registration received: ${info.retreatName}`,
    [{ text: `We've got your registration for ${info.retreatName}.`, strong: true },
      { text: "Your spot is confirmed once your first payment goes through. Spots go to whoever pays first, so don't wait too long." },
      ...room],
    { label: "See your registration", url: info.retreatUrl },
  );
}

export function retreatOfferEmail(info: RetreatEmailInfo, expiresLabel: string): RenderedEmail {
  return render(
    info,
    `A spot opened up: ${info.retreatName}`,
    [{ text: `A spot has opened up for you at ${info.retreatName}.`, strong: true },
      { text: `It's held for you until ${expiresLabel}. To take it, complete your registration on your retreat page before then. After that it's offered to the next person on the waitlist.` }],
    { label: "Claim your spot", url: info.retreatUrl },
  );
}

export function retreatOfferExpiredEmail(info: RetreatEmailInfo): RenderedEmail {
  return render(
    info,
    `Your offer has expired: ${info.retreatName}`,
    [{ text: `The spot we held for you at ${info.retreatName} wasn't taken in time, so it's gone to the next person.` },
      { text: "If you'd still like to come, reply to this email and we'll see what we can do." }],
    null,
  );
}

export function retreatAdminOfferExpiredEmail(params: {
  personName: string;
  retreatName: string;
  dateRange: string;
  registrationsUrl: string;
}): RenderedEmail {
  return render(
    { recipientName: null, retreatName: params.retreatName, dateRange: params.dateRange, retreatUrl: params.registrationsUrl },
    `Offer expired: ${params.personName}, ${params.retreatName}`,
    [{ text: `${params.personName}'s offer for ${params.retreatName} expired without being taken. The spot is free again.` },
      { text: "Nothing moves on by itself: offer it to the next person on the waitlist when you're ready." }],
    { label: "Open registrations", url: params.registrationsUrl },
    "Sent to admins and the retreat lead.",
  );
}

export function retreatRoomDecisionEmail(info: RetreatEmailInfo, approved: boolean): RenderedEmail {
  return render(
    info,
    `Your room request: ${info.retreatName}`,
    approved
      ? [{ text: `Your request for your own room at ${info.retreatName} has been approved.`, strong: true }]
      : [{ text: `We weren't able to give you your own room at ${info.retreatName}. Individual rooms are very limited.` },
          { text: "If your need has changed or there's more we should know, reply to this email." }],
    { label: "See your registration", url: info.retreatUrl },
  );
}

export type PrecheckEmailKind = "opened" | "reminder" | "due_tomorrow" | "overdue";

export function retreatPrecheckEmail(
  info: RetreatEmailInfo,
  kind: PrecheckEmailKind,
  dueLabel: string,
): RenderedEmail {
  const why = "We need it two weeks before the retreat so our team has time to review everyone's information and prepare.";
  const what = "It takes a few minutes: look over your health form and confirm it's still right, or update it if anything has changed.";
  const button = { label: "Complete your pre-retreat check", url: info.retreatUrl };
  switch (kind) {
    case "opened":
      return render(
        info,
        `Action needed by ${dueLabel}: pre-retreat check for ${info.retreatName}`,
        [{ text: `Your pre-retreat check for ${info.retreatName} is open and is due by ${dueLabel}.`, strong: true }, { text: what }, { text: why }],
        button,
      );
    case "reminder":
      return render(
        info,
        `Reminder: pre-retreat check due ${dueLabel}`,
        [{ text: `We still need your pre-retreat check for ${info.retreatName}. It's due by ${dueLabel}.`, strong: true }, { text: what }, { text: why }],
        button,
      );
    case "due_tomorrow":
      return render(
        info,
        `Due tomorrow: pre-retreat check for ${info.retreatName}`,
        [{ text: `Your pre-retreat check for ${info.retreatName} is due tomorrow, ${dueLabel}, and we don't have it yet.`, strong: true }, { text: what }, { text: why }],
        button,
      );
    case "overdue":
      return render(
        info,
        `Overdue: pre-retreat check for ${info.retreatName}`,
        [{ text: `Your pre-retreat check for ${info.retreatName} was due ${dueLabel} and we haven't received it.`, strong: true },
          { text: "Please complete it today. Our team can't finish preparing for the retreat without it, and it now shows as overdue to the retreat team." },
          { text: what }],
        button,
      );
  }
}
