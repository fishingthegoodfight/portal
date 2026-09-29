/**
 * When the volunteer opportunities email goes out (Setup → Volunteer
 * opportunities email; app_settings.opportunities_email_*): on `weekday` in
 * the Sunday-to-Saturday week containing the anchor date, and every 14
 * days either side. Pure date math, shared by the daily run
 * (lib/volunteer-opportunities-email.ts) and the Setup form's preview.
 */

/** Send days are Denver dates, like the other cron jobs. */
export const SCHEDULE_ZONE = "America/Denver";

export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type OpportunitiesSchedule = {
  enabled: boolean;
  /** YYYY-MM-DD: any date in a week the email goes out. */
  anchor: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
};

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const fromDayNumber = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

/** An instant's calendar date in a timezone, YYYY-MM-DD. */
export function dateInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(instant);
}

/** The schedule's weekday in the (Sunday-to-Saturday) week containing the
 * anchor date — one send day; every 14 days either side is another. */
function firstSendDay(schedule: Pick<OpportunitiesSchedule, "anchor" | "weekday">): number {
  const anchor = dayNumber(schedule.anchor);
  const anchorWeekday = new Date(anchor * 86_400_000).getUTCDay();
  return anchor - anchorWeekday + schedule.weekday;
}

/** Whether `date` (YYYY-MM-DD) is a send day — whether or not it's turned on. */
export function isSendDate(schedule: Pick<OpportunitiesSchedule, "anchor" | "weekday">, date: string): boolean {
  const diff = dayNumber(date) - firstSendDay(schedule);
  return ((diff % 14) + 14) % 14 === 0;
}

/** The next `count` send days on or after `from` (YYYY-MM-DD). */
export function nextSendDates(
  schedule: Pick<OpportunitiesSchedule, "anchor" | "weekday">,
  from: string,
  count: number,
): string[] {
  const start = dayNumber(from);
  const first = firstSendDay(schedule);
  const offset = (((first - start) % 14) + 14) % 14;
  return Array.from({ length: count }, (_, i) => fromDayNumber(start + offset + i * 14));
}

/** How many days after a send day a run still works through anyone not yet
 * handled that cycle — a run cut off by the function's time limit or the
 * daily sending cap resumes the next day. Six keeps it inside the week
 * before the following send day is a week away. */
export const CATCH_UP_DAYS = 6;

/** The most recent send day on or before `today`. */
export function currentCycleStart(schedule: Pick<OpportunitiesSchedule, "anchor" | "weekday">, today: string): string {
  const diff = dayNumber(today) - firstSendDay(schedule);
  return fromDayNumber(dayNumber(today) - (((diff % 14) + 14) % 14));
}

/** Days from `from` to `to` (YYYY-MM-DD each). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}
