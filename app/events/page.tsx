import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { ChapterTag } from "@/components/chapter-tag";
import { RegionTag } from "@/components/region-tag";
import { calendarMonth, calendarRange, EventCalendar, EventsViewToggle } from "@/components/event-calendar";
import { Card, CardContent } from "@/components/ui/card";
import { EVENTS_PAGE_SIZE, groupByMonth, MonthHeading, ShowMoreEvents, showLimit } from "@/components/event-months";
import { isVirtualChapter } from "@/lib/chapters";
import { publicEventPath } from "@/lib/event-slug";
import { formatEventDateRange, todayInZone } from "@/lib/format-date";
import { loadPublicRegionsAndChapters, loadUpcomingPublicEvents, publicLocationSummary } from "@/lib/public-events";
import { eventFilterChapters, regionName } from "@/lib/retreats";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Upcoming events · Fishing the Good Fight",
  description: "Upcoming Fishing the Good Fight events.",
};

const VIRTUAL = "Virtual";
const pillLabel = (chapter: string) => (isVirtualChapter(chapter) ? VIRTUAL : chapter);

type EventsSearchParams = { chapter?: string; show?: string; view?: string; month?: string };

function eventsHref(chapter: string | null, opts: { show?: number; calendar?: boolean; month?: string } = {}): string {
  const params = new URLSearchParams();
  if (chapter) params.set("chapter", chapter);
  if (opts.calendar) params.set("view", "calendar");
  if (opts.month) params.set("month", opts.month);
  if (opts.show) params.set("show", String(opts.show));
  const query = params.toString();
  return query ? `/events?${query}` : "/events";
}

async function EventList({ searchParams }: { searchParams: Promise<EventsSearchParams> }) {
  await connection(); // "upcoming" is about now, not build time
  const { chapter, show, view, month: monthParam } = await searchParams;
  const calendar = view === "calendar";
  let events;
  try {
    events = await loadUpcomingPublicEvents(new Date());
  } catch {
    return <p className="text-sm text-red-500">Couldn&apos;t load events. Please try again in a moment.</p>;
  }

  // A retreat shows under every chapter in its region.
  const places = await loadPublicRegionsAndChapters();
  const pillsOf = (e: (typeof events)[number]) => eventFilterChapters(e, places.chapters).map(pillLabel);
  const chapters = [...new Set(events.filter((e) => e.kind !== "retreat").flatMap(pillsOf))];
  const selected = chapter && chapters.includes(chapter) ? chapter : null;
  const matching = selected ? events.filter((e) => pillsOf(e).includes(selected)) : events;
  const limit = showLimit(show);
  const shown = matching.slice(0, limit);

  return (
    <div className="flex flex-col gap-4">
      <EventsViewToggle
        view={calendar ? "calendar" : "list"}
        listHref={eventsHref(selected)}
        calendarHref={eventsHref(selected, { calendar: true })}
      />
      {chapters.length > 1 && (
        <nav aria-label="Chapters" className="flex flex-wrap gap-2">
          {[null, ...chapters].map((name) => (
            <Link
              key={name ?? "all"}
              href={eventsHref(name, { calendar })}
              scroll={false}
              aria-current={name === selected ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                name === selected ? "border-foreground bg-foreground text-background" : "hover:bg-accent",
              )}
            >
              {name ?? "All"}
            </Link>
          ))}
        </nav>
      )}
      {calendar ? (
        <PublicCalendar events={matching} chapter={selected} monthParam={monthParam} />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No upcoming events right now. Check back soon.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {groupByMonth(shown).map((month) => (
            <section key={month.label} className="flex flex-col gap-3">
              <MonthHeading label={month.label} />
              <ul className="flex flex-col gap-3">
                {month.events.map((event) => {
                  const where = publicLocationSummary(event);
                  return (
                    <li key={event.id}>
                      <Link href={publicEventPath(event.slug)} className="block">
                        <Card className="transition-colors hover:bg-accent/50">
                          <CardContent className="flex flex-col gap-1 py-4">
                            <span className="font-semibold">{event.name}</span>
                            <span className="text-sm text-muted-foreground">
                              {formatEventDateRange(event.starts_at, event.ends_at, event.timezone)}
                            </span>
                            <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                              {event.kind === "retreat" ? (
                                <RegionTag region={regionName(event.region_id, places.regions)} />
                              ) : (
                                event.chapter && <ChapterTag chapter={event.chapter} />
                              )}
                              {event.kind !== "retreat" && where}
                            </span>
                          </CardContent>
                        </Card>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <ShowMoreEvents href={eventsHref(selected, { show: limit + EVENTS_PAGE_SIZE })} shown={shown.length} total={matching.length} />
        </div>
      )}
    </div>
  );
}


async function PublicCalendar({
  events,
  chapter,
  monthParam,
}: {
  events: Awaited<ReturnType<typeof loadUpcomingPublicEvents>>;
  chapter: string | null;
  monthParam: string | undefined;
}) {
  const today = todayInZone("America/Denver");
  const range = calendarRange(events, today);
  // Chapter names in display order, for the calendar's colors.
  const { regions, chapters } = await loadPublicRegionsAndChapters();
  return (
    <EventCalendar
      events={events.map((e) => ({
        id: e.id,
        name: e.name,
        href: publicEventPath(e.slug),
        chapter: e.kind === "retreat" ? `${regionName(e.region_id, regions) ?? "Region"} retreat` : e.chapter,
        starts_at: e.starts_at,
        ends_at: e.ends_at,
        timezone: e.timezone,
      }))}
      month={calendarMonth(monthParam, range.firstMonth, range.lastMonth)}
      today={today}
      {...range}
      chapterOrder={chapters.map((c) => c.name)}
      monthHref={(month) => eventsHref(chapter, { calendar: true, month })}
    />
  );
}

/**
 * The public list of upcoming events: what the walk-up welcome email's
 * "See what's coming up" opens, readable without signing in. Each row links
 * to the event's existing public page; nothing is shown that those pages
 * don't already show (loadUpcomingPublicEvents).
 */
export default function UpcomingEventsPage({ searchParams }: { searchParams: Promise<EventsSearchParams> }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6 md:p-10">
      <div>
        <h1 className="text-2xl font-bold">Upcoming events</h1>
        <p className="text-sm text-muted-foreground">
          Fishing the Good Fight events coming up. Open one to see the details and RSVP.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <EventList searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
