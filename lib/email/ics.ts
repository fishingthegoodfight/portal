/**
 * .ics (iCalendar, RFC 5545) generation for RSVP and admin-triggered event
 * emails: a METHOD:REQUEST invite on confirmation or an attendee-notified
 * edit, a METHOD:CANCEL update (same UID) on RSVP or event cancellation, so
 * calendar apps replace rather than duplicate the entry.
 *
 * VTIMEZONE is built generically from each zone's actual UTC offset (via
 * Intl) rather than a hardcoded table, so a new chapter in any US timezone
 * works without a code change. It assumes the post-2007 US DST rule (starts
 * 2nd Sunday in March, ends 1st Sunday in November) — true for every chapter
 * timezone today (America/Denver, America/New_York) — and falls back to a
 * single fixed offset for a zone that doesn't observe DST at all (e.g.
 * America/Phoenix).
 */

import { getTimeZoneOffsetMinutes } from "@/lib/timezone";

export type IcsEventInput = {
  id: number;
  name: string;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  location: string | null;
  /** Zoom/meeting link — becomes the ICS LOCATION when there's no physical
   * location (a virtual event has none), and always appears in the
   * DESCRIPTION alongside virtualAccessNotes so it's visible in the calendar
   * entry when the event starts. Callers only ever pass this for someone
   * with a confirmed RSVP — see lib/email/send.ts. */
  virtualLink?: string | null;
  virtualAccessNotes?: string | null;
};

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

function formatIcsDateTimeUTC(date: Date): string {
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

/** A date's wall-clock time in `timeZone`, formatted for a DTSTART/DTEND
 * that carries `TZID=<timeZone>` (no trailing Z — local, not UTC). */
function formatIcsDateTimeInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  // Some engines format midnight as hour "24" under hour12:false.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}${get("month")}${get("day")}T${hour}${get("minute")}${get("second")}`;
}

function formatIcsOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

function buildVTimezone(timeZone: string, referenceYear: number): string {
  const winterOffset = getTimeZoneOffsetMinutes(
    new Date(Date.UTC(referenceYear, 0, 15, 12)),
    timeZone,
  );
  const summerOffset = getTimeZoneOffsetMinutes(
    new Date(Date.UTC(referenceYear, 6, 15, 12)),
    timeZone,
  );

  if (winterOffset === summerOffset) {
    return [
      "BEGIN:VTIMEZONE",
      `TZID:${timeZone}`,
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      `TZOFFSETFROM:${formatIcsOffset(winterOffset)}`,
      `TZOFFSETTO:${formatIcsOffset(winterOffset)}`,
      "END:STANDARD",
      "END:VTIMEZONE",
    ].join("\r\n");
  }

  const standardOffset = Math.min(winterOffset, summerOffset);
  const daylightOffset = Math.max(winterOffset, summerOffset);

  return [
    "BEGIN:VTIMEZONE",
    `TZID:${timeZone}`,
    "BEGIN:DAYLIGHT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    `TZOFFSETFROM:${formatIcsOffset(standardOffset)}`,
    `TZOFFSETTO:${formatIcsOffset(daylightOffset)}`,
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    `TZOFFSETFROM:${formatIcsOffset(daylightOffset)}`,
    `TZOFFSETTO:${formatIcsOffset(standardOffset)}`,
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n");
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** RFC 5545 folds lines at 75 octets; long SUMMARY/LOCATION values can
 * exceed that. */
function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  let result = "";
  let rest = line;
  while (rest.length > 75) {
    result += rest.slice(0, 75) + "\r\n ";
    rest = rest.slice(75);
  }
  return result + rest;
}

export function icsUidForEvent(eventId: number): string {
  return `event-${eventId}@fishingthegoodfight.org`;
}

export function buildEventIcs({
  event,
  method,
  sequence,
}: {
  event: IcsEventInput;
  method: "REQUEST" | "CANCEL";
  /**
   * events.ics_sequence at the time this is sent — the caller owns bumping
   * it (on a date/time/location edit or a cancellation) and persisting the
   * new value, so every calendar client that's seen an earlier SEQUENCE for
   * this UID accepts this one as the newer version rather than ignoring it.
   */
  sequence: number;
}): string {
  const start = new Date(event.startsAt);
  const end = event.endsAt
    ? new Date(event.endsAt)
    : new Date(start.getTime() + 60 * 60 * 1000);

  const uid = icsUidForEvent(event.id);
  const dtstamp = formatIcsDateTimeUTC(new Date());
  const status = method === "CANCEL" ? "CANCELLED" : "CONFIRMED";
  // A virtual event has no physical location, so the link fills LOCATION too
  // — the two are mutually exclusive per event (see admin-event.ts).
  const location = event.location || event.virtualLink || null;
  const description = event.virtualLink
    ? [event.virtualLink, event.virtualAccessNotes].filter(Boolean).join("\n\n")
    : null;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fishing the Good Fight//RSVP//EN",
    `METHOD:${method}`,
    "CALSCALE:GREGORIAN",
    buildVTimezone(event.timezone, start.getUTCFullYear()),
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=${event.timezone}:${formatIcsDateTimeInZone(start, event.timezone)}`,
    `DTEND;TZID=${event.timezone}:${formatIcsDateTimeInZone(end, event.timezone)}`,
    foldIcsLine(`SUMMARY:${escapeIcsText(event.name)}`),
    ...(location ? [foldIcsLine(`LOCATION:${escapeIcsText(location)}`)] : []),
    ...(description ? [foldIcsLine(`DESCRIPTION:${escapeIcsText(description)}`)] : []),
    `SEQUENCE:${sequence}`,
    `STATUS:${status}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.join("\r\n") + "\r\n";
}

/** "Add to Google Calendar" link used as the email's fallback to the .ics
 * attachment. */
export function buildGoogleCalendarLink(event: IcsEventInput): string {
  const start = new Date(event.startsAt);
  const end = event.endsAt
    ? new Date(event.endsAt)
    : new Date(start.getTime() + 60 * 60 * 1000);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.name,
    dates: `${formatIcsDateTimeUTC(start)}/${formatIcsDateTimeUTC(end)}`,
    ctz: event.timezone,
  });
  const location = event.location || event.virtualLink || null;
  if (location) params.set("location", location);
  if (event.virtualLink && event.virtualAccessNotes) {
    params.set("details", event.virtualAccessNotes);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
