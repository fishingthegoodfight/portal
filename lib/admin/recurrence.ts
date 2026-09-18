/**
 * Pure calendar-date math for the "New event" wizard's recurrence step —
 * no timezone conversion here (that happens per-occurrence, combining each
 * generated date with the admin's chosen time via lib/timezone.ts). Shared
 * between the client (to preview generated dates before submit) and the
 * createEventAction server action (to actually build the rows), so the
 * preview can never drift from what gets created.
 */

export type RecurrenceFrequency = "weekly" | "biweekly" | "monthly";

export const MAX_RECURRENCE_OCCURRENCES = 52;

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * The next month's *nth occurrence of the same weekday* as `date` — e.g. the
 * 2nd Tuesday — not the same day-of-month number, which drifts onto the
 * wrong weekday and can land on a date that doesn't exist. If that nth
 * weekday doesn't exist in the immediate next month (a "5th Tuesday" isn't
 * every month), advances month by month until it finds one instead of
 * silently producing a wrong-month date.
 */
function nextMonthlySameWeekday(date: Date): Date {
  const weekday = date.getUTCDay();
  const ordinal = Math.floor((date.getUTCDate() - 1) / 7);

  for (let monthOffset = 1; monthOffset <= 12; monthOffset++) {
    const targetMonthStart = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + monthOffset, 1),
    );
    const firstWeekday = targetMonthStart.getUTCDay();
    let dayOffset = weekday - firstWeekday;
    if (dayOffset < 0) dayOffset += 7;
    const day = 1 + dayOffset + ordinal * 7;
    const candidate = new Date(
      Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth(), day),
    );
    if (candidate.getUTCMonth() === targetMonthStart.getUTCMonth()) {
      return candidate;
    }
  }
  throw new Error("Could not find a monthly occurrence within 12 months");
}

/**
 * Generates the occurrence dates ("YYYY-MM-DD") for a recurring event,
 * starting at `startDate` (always included first) and repeating through
 * `endDate` inclusive, capped at MAX_RECURRENCE_OCCURRENCES total.
 */
export function generateRecurrenceDates(
  startDate: string,
  frequency: RecurrenceFrequency,
  endDate: string,
): string[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const dates: Date[] = [start];

  let current = start;
  while (dates.length < MAX_RECURRENCE_OCCURRENCES) {
    const next =
      frequency === "weekly"
        ? addDays(current, 7)
        : frequency === "biweekly"
          ? addDays(current, 14)
          : nextMonthlySameWeekday(current);
    if (next.getTime() > end.getTime()) break;
    dates.push(next);
    current = next;
  }

  return dates.map(formatDate);
}
