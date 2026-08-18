const dateFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Formats an event's start/end timestamps for display, e.g.
 * "Wed, Sep 3 · 6:00 – 8:00 PM" when both fall on the same day, or
 * "Wed, Sep 3 · 6:00 PM – Thu, Sep 4 · 9:00 AM" when they don't.
 */
export function formatEventDateRange(
  startsAt: string,
  endsAt: string | null,
): string {
  const start = new Date(startsAt);
  const startDate = dateFmt.format(start);
  const startTime = timeFmt.format(start);

  if (!endsAt) return `${startDate} · ${startTime}`;

  const end = new Date(endsAt);
  const sameDay = start.toDateString() === end.toDateString();

  if (sameDay) {
    return `${startDate} · ${startTime} – ${timeFmt.format(end)}`;
  }
  return `${startDate} · ${startTime} – ${dateFmt.format(end)} · ${timeFmt.format(end)}`;
}
