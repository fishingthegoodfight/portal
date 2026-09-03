function buildFormatters(timeZone: string) {
  return {
    // Calendar date only — also doubles as the "same day?" comparison below,
    // so that comparison happens in the event's own zone rather than the
    // runtime's local one.
    date: new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone,
    }),
    time: new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }),
    // Same as `time` but with the zone abbreviation appended — used once per
    // range so the reader always knows which timezone the times are in,
    // without repeating it at both ends of a same-day range.
    timeWithZone: new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    }),
  };
}

/**
 * Formats an event's start/end timestamps for display in the event's own
 * (venue) timezone, e.g. "Wed, Sep 3 · 6:00 – 8:00 PM MDT" when both fall on
 * the same day there, or "Wed, Sep 3 · 6:00 PM – Thu, Sep 4 · 9:00 AM MDT"
 * when they don't.
 *
 * `timeZone` is an IANA zone name (e.g. "America/Denver") — an in-person
 * event should always read the same wall-clock time to every viewer,
 * wherever they are, rather than being converted to each viewer's local
 * zone. Passing a fixed zone in also keeps this safe to call from a client
 * component: formatting the same instant with the browser's local zone
 * during SSR vs. hydration is what caused the earlier hydration mismatch.
 */
export function formatEventDateRange(
  startsAt: string,
  endsAt: string | null,
  timeZone: string,
): string {
  const { date, time, timeWithZone } = buildFormatters(timeZone);
  const start = new Date(startsAt);
  const startDate = date.format(start);
  const end = endsAt ? new Date(endsAt) : null;

  // No end time, or an end that's just a copy of the start (some events get
  // saved that way) — show the start only, not "6:00 PM – 6:00 PM".
  if (!end || end.getTime() === start.getTime()) {
    return `${startDate} · ${timeWithZone.format(start)}`;
  }

  const sameDay = startDate === date.format(end);

  if (sameDay) {
    return `${startDate} · ${time.format(start)} – ${timeWithZone.format(end)}`;
  }
  return `${startDate} · ${time.format(start)} – ${date.format(end)} · ${timeWithZone.format(end)}`;
}
