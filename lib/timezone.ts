/**
 * Shared IANA-timezone helpers for converting between an admin's wall-clock
 * date/time input and the UTC instant events.starts_at/ends_at actually
 * store — so no form ever asks anyone to think in UTC. Also backs the
 * offset math lib/email/ics.ts needs for VTIMEZONE.
 */

/** UTC offset of `timeZone` at `date`, in minutes (e.g. -360 for CST). */
export function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const match = raw.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = match[3] ? Number(match[3]) : 0;
  return sign * (hours * 60 + minutes);
}

/** A UTC instant's wall-clock date/time in `timeZone`, as the exact strings
 * native `<input type="date">`/`<input type="time">` elements expect. */
export function toZonedDateTimeInputs(
  date: Date,
  timeZone: string,
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  // Some engines format midnight as hour "24" under hour12:false.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
  };
}

/**
 * The reverse: an admin's "2026-07-15" + "18:00" + "America/Denver" input,
 * converted to the UTC instant that reads as that wall-clock time in that
 * zone. Iterates the offset lookup twice, which is enough to settle right at
 * a DST transition boundary (the offset used to compute the instant can
 * itself change once you're close to it).
 */
export function zonedDateTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const naiveUtcMillis = Date.UTC(year, month - 1, day, hour, minute, 0);

  let millis = naiveUtcMillis;
  for (let i = 0; i < 2; i++) {
    const offset = getTimeZoneOffsetMinutes(new Date(millis), timeZone);
    const corrected = naiveUtcMillis - offset * 60_000;
    if (corrected === millis) break;
    millis = corrected;
  }
  return new Date(millis);
}
