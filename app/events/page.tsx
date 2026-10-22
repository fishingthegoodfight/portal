import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { ChapterTag } from "@/components/chapter-tag";
import { Card, CardContent } from "@/components/ui/card";
import { EVENTS_PAGE_SIZE, groupByMonth, MonthHeading, ShowMoreEvents, showLimit } from "@/components/event-months";
import { isVirtualChapter } from "@/lib/chapters";
import { publicEventPath } from "@/lib/event-slug";
import { formatEventDateRange } from "@/lib/format-date";
import { loadUpcomingPublicEvents, publicLocationSummary } from "@/lib/public-events";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Upcoming events · Fishing the Good Fight",
  description: "Upcoming Fishing the Good Fight events.",
};

const VIRTUAL = "Virtual";
const pillLabel = (chapter: string) => (isVirtualChapter(chapter) ? VIRTUAL : chapter);

type EventsSearchParams = { chapter?: string; show?: string };

function eventsHref(chapter: string | null, show?: number): string {
  const params = new URLSearchParams();
  if (chapter) params.set("chapter", chapter);
  if (show) params.set("show", String(show));
  const query = params.toString();
  return query ? `/events?${query}` : "/events";
}

async function EventList({ searchParams }: { searchParams: Promise<EventsSearchParams> }) {
  await connection(); // "upcoming" is about now, not build time
  const { chapter, show } = await searchParams;
  let events;
  try {
    events = await loadUpcomingPublicEvents(new Date());
  } catch {
    return <p className="text-sm text-red-500">Couldn&apos;t load events. Please try again in a moment.</p>;
  }

  const chapters = [...new Set(events.map((e) => (e.chapter ? pillLabel(e.chapter) : null)).filter(Boolean))] as string[];
  const selected = chapter && chapters.includes(chapter) ? chapter : null;
  const matching = selected ? events.filter((e) => e.chapter && pillLabel(e.chapter) === selected) : events;
  const limit = showLimit(show);
  const shown = matching.slice(0, limit);

  return (
    <div className="flex flex-col gap-4">
      {chapters.length > 1 && (
        <nav aria-label="Chapters" className="flex flex-wrap gap-2">
          {[null, ...chapters].map((name) => (
            <Link
              key={name ?? "all"}
              href={eventsHref(name)}
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
      {shown.length === 0 ? (
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
                              {event.chapter && <ChapterTag chapter={event.chapter} />}
                              {where}
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
          <ShowMoreEvents href={eventsHref(selected, limit + EVENTS_PAGE_SIZE)} shown={shown.length} total={matching.length} />
        </div>
      )}
    </div>
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
