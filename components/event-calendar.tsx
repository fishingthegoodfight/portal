import Link from "next/link";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";

import { isVirtualChapter } from "@/lib/chapters";
import { addDays, dateInZone } from "@/lib/format-date";
import { cn } from "@/lib/utils";

/**
 * The month view of an events list (the public /events page and the
 * signed-in Events page, ?view=calendar). A server component with no client
 * JavaScript: months and filters are links, like the list's filter pills.
 *
 * Each chapter has one color everywhere, picked by its place in the
 * chapters' display order (Setup → Regions & chapters), so it stays put as
 * events come and go; Virtual is always gray. On a phone the grid shows dots
 * and the month's events are listed by day under it.
 */

/** Full class strings, so Tailwind sees them (it doesn't scan lib/). */
const PALETTE = [
  { chip: "border-l-blue-500 bg-blue-50 text-blue-950 dark:bg-blue-950/60 dark:text-blue-100", dot: "bg-blue-500" },
  { chip: "border-l-amber-500 bg-amber-50 text-amber-950 dark:bg-amber-950/60 dark:text-amber-100", dot: "bg-amber-500" },
  { chip: "border-l-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-100", dot: "bg-emerald-500" },
  { chip: "border-l-violet-500 bg-violet-50 text-violet-950 dark:bg-violet-950/60 dark:text-violet-100", dot: "bg-violet-500" },
  { chip: "border-l-rose-500 bg-rose-50 text-rose-950 dark:bg-rose-950/60 dark:text-rose-100", dot: "bg-rose-500" },
  { chip: "border-l-cyan-500 bg-cyan-50 text-cyan-950 dark:bg-cyan-950/60 dark:text-cyan-100", dot: "bg-cyan-500" },
  { chip: "border-l-orange-500 bg-orange-50 text-orange-950 dark:bg-orange-950/60 dark:text-orange-100", dot: "bg-orange-500" },
  { chip: "border-l-fuchsia-500 bg-fuchsia-50 text-fuchsia-950 dark:bg-fuchsia-950/60 dark:text-fuchsia-100", dot: "bg-fuchsia-500" },
  { chip: "border-l-lime-600 bg-lime-50 text-lime-950 dark:bg-lime-950/60 dark:text-lime-100", dot: "bg-lime-600" },
  { chip: "border-l-teal-600 bg-teal-50 text-teal-950 dark:bg-teal-950/60 dark:text-teal-100", dot: "bg-teal-600" },
];
const NEUTRAL = {
  chip: "border-l-slate-400 bg-slate-100 text-slate-900 dark:bg-slate-800/70 dark:text-slate-100",
  dot: "bg-slate-400",
};

type Swatch = { chip: string; dot: string };

/** A chapter's color: its place among `chapterOrder` (every chapter, in
 * display order, inactive ones included so nobody's color shifts when one
 * closes). A chapter missing from the list gets one from its name. */
function chapterSwatch(chapter: string | null, chapterOrder: string[]): Swatch {
  if (!chapter || isVirtualChapter(chapter)) return NEUTRAL;
  const local = chapterOrder.filter((c) => !isVirtualChapter(c));
  let index = local.indexOf(chapter);
  if (index < 0) index = [...chapter].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return PALETTE[index % PALETTE.length];
}

const chapterLabel = (chapter: string | null) =>
  !chapter ? "No chapter" : isVirtualChapter(chapter) ? "Virtual" : chapter;

export type CalendarEvent = {
  id: number;
  name: string;
  href: string;
  chapter: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  /** The viewer is going (a check on the chip). */
  going?: boolean;
};

/** "6p", "6:30p": short enough for a day cell. */
function shortTime(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).formatToParts(
    new Date(instant),
  );
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").charAt(0).toLowerCase();
  return `${hour}${minute === "00" ? "" : `:${minute}`}${period}`;
}

function longTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(instant));
}

/** Every calendar day an event is on, in its own time zone (a retreat shows
 * on each of its days). Capped at a month. */
function eventDays(event: CalendarEvent): string[] {
  const first = dateInZone(new Date(event.starts_at), event.timezone);
  const last = event.ends_at ? dateInZone(new Date(event.ends_at), event.timezone) : first;
  const days = [first];
  while (days.length < 31 && days.at(-1)! < last) days.push(addDays(days.at(-1)!, 1));
  return days;
}

/** "YYYY-MM" for a "YYYY-MM-DD" date. */
export const monthOf = (date: string) => date.slice(0, 7);

/** The month in `?month=`, kept between `first` and `last` ("YYYY-MM"). */
export function calendarMonth(param: string | undefined, first: string, last: string): string {
  if (!param || !/^\d{4}-(0[1-9]|1[0-2])$/.test(param)) return first;
  return param < first ? first : param > last ? last : param;
}

/** The months the calendar can show: this one (Denver) through the month
 * the last event ends in. Expects events in date order. */
export function calendarRange(
  events: { starts_at: string; ends_at: string | null; timezone: string }[],
  today: string,
): { firstMonth: string; lastMonth: string } {
  const firstMonth = monthOf(today);
  const last = events.at(-1);
  const lastEventMonth = last ? monthOf(dateInZone(new Date(last.ends_at ?? last.starts_at), last.timezone)) : firstMonth;
  return { firstMonth, lastMonth: lastEventMonth > firstMonth ? lastEventMonth : firstMonth };
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

const monthTitle = (month: string) =>
  new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-01T12:00:00Z`),
  );

const dayTitle = (date: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** List | Calendar, as two linked pills. */
export function EventsViewToggle({
  view,
  listHref,
  calendarHref,
}: {
  view: "list" | "calendar";
  listHref: string;
  calendarHref: string;
}) {
  const item = (active: boolean) =>
    cn(
      "px-3 py-1 text-sm transition-colors",
      active ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground",
    );
  return (
    <nav aria-label="View" className="inline-flex self-start overflow-hidden rounded-full border">
      <Link href={listHref} scroll={false} aria-current={view === "list" ? "page" : undefined} className={item(view === "list")}>
        List
      </Link>
      <Link
        href={calendarHref}
        scroll={false}
        aria-current={view === "calendar" ? "page" : undefined}
        className={cn(item(view === "calendar"), "border-l")}
      >
        Calendar
      </Link>
    </nav>
  );
}

export function EventCalendar({
  events,
  month,
  today,
  firstMonth,
  lastMonth,
  chapterOrder,
  monthHref,
}: {
  /** Upcoming events, in date order. */
  events: CalendarEvent[];
  /** The month shown, "YYYY-MM". */
  month: string;
  /** "YYYY-MM-DD", for marking today. */
  today: string;
  /** The months the arrows can reach. */
  firstMonth: string;
  lastMonth: string;
  /** Every chapter's name in display order (chapterSwatch). */
  chapterOrder: string[];
  monthHref: (month: string) => string;
}) {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    for (const day of eventDays(event)) {
      const list = byDay.get(day) ?? [];
      list.push(event);
      byDay.set(day, list);
    }
  }

  // Sunday-first weeks covering the month.
  const firstDay = `${month}-01`;
  const lead = new Date(`${firstDay}T12:00:00Z`).getUTCDay();
  const gridStart = addDays(firstDay, -lead);
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));

  const monthDays = cells.filter((d) => monthOf(d) === month && byDay.has(d));
  const monthEvents = [...new Set(monthDays.flatMap((d) => byDay.get(d)!))];
  const legend = [...new Set(monthEvents.map((e) => e.chapter))].sort((a, b) => {
    const order = (c: string | null) => (c == null ? 1e6 : isVirtualChapter(c) ? 1e5 : chapterOrder.indexOf(c));
    return order(a) - order(b);
  });

  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const arrow = "inline-flex size-8 items-center justify-center rounded-md border";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{monthTitle(month)}</h2>
        <div className="flex gap-1">
          {month > firstMonth ? (
            <Link href={monthHref(prev)} scroll={false} className={cn(arrow, "hover:bg-accent")} aria-label={monthTitle(prev)}>
              <ChevronLeft className="size-4" />
            </Link>
          ) : (
            <span className={cn(arrow, "opacity-40")} aria-hidden>
              <ChevronLeft className="size-4" />
            </span>
          )}
          {month < lastMonth ? (
            <Link href={monthHref(next)} scroll={false} className={cn(arrow, "hover:bg-accent")} aria-label={monthTitle(next)}>
              <ChevronRight className="size-4" />
            </Link>
          ) : (
            <span className={cn(arrow, "opacity-40")} aria-hidden>
              <ChevronRight className="size-4" />
            </span>
          )}
        </div>
      </div>

      {legend.length > 1 && (
        <ul aria-label="Chapters" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {legend.map((chapter) => (
            <li key={chapter ?? "none"} className="flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-full", chapterSwatch(chapter, chapterOrder).dot)} aria-hidden />
              {chapterLabel(chapter)}
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-hidden rounded-md border">
        <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs font-medium text-muted-foreground">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1.5">
              <span className="sm:hidden">{d.charAt(0)}</span>
              <span className="hidden sm:inline">{d}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            const inMonth = monthOf(day) === month;
            const dayEvents = inMonth ? (byDay.get(day) ?? []) : [];
            const isToday = day === today;
            const dayNumber = (
              <span
                className={cn(
                  "inline-flex size-6 items-center justify-center rounded-full text-xs",
                  isToday && "bg-foreground font-semibold text-background",
                  !inMonth && "text-muted-foreground/50",
                  inMonth && day < today && !isToday && "text-muted-foreground",
                )}
              >
                {Number(day.slice(8))}
              </span>
            );
            return (
              <div
                key={day}
                className={cn(
                  "min-h-14 border-muted p-1 sm:min-h-24",
                  i % 7 !== 6 && "border-r",
                  i < cells.length - 7 && "border-b",
                  !inMonth && "bg-muted/30",
                )}
              >
                {/* Phone: the number and a dot per event, jumping to the day below. */}
                {dayEvents.length > 0 ? (
                  <a href={`#cal-${day}`} className="flex flex-col items-center gap-1 sm:hidden" aria-label={`${dayTitle(day)}: ${dayEvents.length} ${dayEvents.length === 1 ? "event" : "events"}`}>
                    {dayNumber}
                    <span className="flex flex-wrap justify-center gap-0.5">
                      {dayEvents.slice(0, 4).map((e) => (
                        <span key={e.id} className={cn("size-1.5 rounded-full", chapterSwatch(e.chapter, chapterOrder).dot)} />
                      ))}
                    </span>
                  </a>
                ) : (
                  <div className="flex justify-center sm:hidden">{dayNumber}</div>
                )}
                {/* Wider screens: a chip per event. */}
                <div className="hidden flex-col gap-1 sm:flex">
                  {dayNumber}
                  {dayEvents.map((e) => {
                    const startsToday = dateInZone(new Date(e.starts_at), e.timezone) === day;
                    return (
                      <Link
                        key={e.id}
                        href={e.href}
                        title={`${e.name} · ${chapterLabel(e.chapter)}`}
                        className={cn(
                          "flex flex-col rounded-sm border-l-[3px] px-1 py-0.5 text-[11px] leading-tight hover:opacity-80",
                          chapterSwatch(e.chapter, chapterOrder).chip,
                        )}
                      >
                        {(startsToday || e.going) && (
                          <span className="font-semibold">
                            {e.going && <Check className="mr-0.5 inline size-3" strokeWidth={3} aria-label="You're going" />}
                            {startsToday && shortTime(e.starts_at, e.timezone)}
                          </span>
                        )}
                        {/* Two lines, then cut: a cell is narrow. */}
                        <span className="line-clamp-2 break-words">{e.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {monthDays.length === 0 ? (
        <p className="text-sm text-muted-foreground">No upcoming events in {monthTitle(month)}.</p>
      ) : (
        // Phone: the month's events by day.
        <div className="flex flex-col gap-4 sm:hidden">
          {monthDays.map((day) => (
            <section key={day} id={`cal-${day}`} className="flex scroll-mt-24 flex-col gap-2">
              <h3 className="text-sm font-semibold">{dayTitle(day)}</h3>
              <ul className="flex flex-col gap-2">
                {byDay.get(day)!.map((e) => {
                  const startsToday = dateInZone(new Date(e.starts_at), e.timezone) === day;
                  return (
                    <li key={e.id}>
                      <Link
                        href={e.href}
                        className={cn(
                          "flex flex-col rounded-md border-l-4 px-3 py-2 text-sm hover:opacity-80",
                          chapterSwatch(e.chapter, chapterOrder).chip,
                        )}
                      >
                        <span className="font-medium">
                          {e.going && <Check className="mr-1 inline size-3.5" strokeWidth={3} aria-label="You're going" />}
                          {e.name}
                        </span>
                        <span className="text-xs opacity-80">
                          {startsToday ? longTime(e.starts_at, e.timezone) : "Continues"} · {chapterLabel(e.chapter)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
