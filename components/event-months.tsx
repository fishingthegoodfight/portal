import Link from "next/link";

/** How many events an events list shows at first, and how many more each
 * "Show more" adds (the public /events page and the signed-in Events page). */
export const EVENTS_PAGE_SIZE = 10;

/** The `?show=` count from the URL, never less than one page. */
export function showLimit(show: string | undefined): number {
  return Math.max(EVENTS_PAGE_SIZE, Number.parseInt(show ?? "", 10) || EVENTS_PAGE_SIZE);
}

/** Consecutive events grouped under "November 2026"-style headings, each
 * month in the event's own time zone. Expects events in date order. */
export function groupByMonth<T extends { starts_at: string; timezone: string }>(
  events: T[],
): { label: string; events: T[] }[] {
  const months: { label: string; events: T[] }[] = [];
  for (const event of events) {
    const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: event.timezone }).format(
      new Date(event.starts_at),
    );
    const last = months.at(-1);
    if (last?.label === label) last.events.push(event);
    else months.push({ label, events: [event] });
  }
  return months;
}

export function MonthHeading({ label }: { label: string }) {
  return <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{label}</h2>;
}

/** "Show 10 more" under a list cut to `shown` of `total`; nothing once
 * everything is showing. `href` is the same list with a larger `show`. */
export function ShowMoreEvents({ href, shown, total }: { href: string; shown: number; total: number }) {
  if (shown >= total) return null;
  return (
    <div className="flex flex-col items-center gap-1">
      <Link href={href} scroll={false} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">
        Show {Math.min(EVENTS_PAGE_SIZE, total - shown)} more
      </Link>
      <span className="text-xs text-muted-foreground">
        Showing {shown} of {total} upcoming events
      </span>
    </div>
  );
}
