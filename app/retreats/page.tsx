import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { FilterPill, filterHref } from "@/components/filter-pills";
import { RegionTag } from "@/components/region-tag";
import { retreatSpotsLabel } from "@/components/retreats/public-retreat";
import { spotsLeft as computeSpotsLeft } from "@/lib/event-capacity";
import { publicEventPath } from "@/lib/event-slug";
import { formatEventDateRange } from "@/lib/format-date";
import { loadPublicRegionsAndChapters, loadUpcomingPublicEvents } from "@/lib/public-events";
import { regionName } from "@/lib/retreats";

export const metadata: Metadata = {
  title: "Retreats · Fishing the Good Fight",
  description: "Upcoming Fishing the Good Fight retreats.",
};

const BASE_PATH = "/retreats";

/** Upcoming retreats, filterable by region. The same anon reads as the
 * public events list, so it shows nothing those pages don't. */
async function RetreatList({ searchParams }: { searchParams: Promise<{ region?: string }> }) {
  await connection(); // "upcoming" is about now
  const { region: regionParam } = await searchParams;
  let events;
  try {
    events = (await loadUpcomingPublicEvents(new Date())).filter((e) => e.kind === "retreat");
  } catch {
    return <p className="text-sm text-red-500">Couldn&apos;t load retreats. Please try again in a moment.</p>;
  }
  const { regions } = await loadPublicRegionsAndChapters();
  const used = regions.filter((r) => events.some((e) => e.region_id === r.id));
  const selected = used.find((r) => String(r.id) === regionParam) ?? null;
  const shown = selected ? events.filter((e) => e.region_id === selected.id) : events;

  return (
    <div className="flex flex-col gap-4">
      {used.length > 1 && (
        <div role="group" aria-label="Region" className="flex flex-wrap gap-2">
          <FilterPill href={BASE_PATH} active={!selected}>
            All regions
          </FilterPill>
          {used.map((r) => (
            <FilterPill key={r.id} href={filterHref(BASE_PATH, { region: String(r.id) })} active={selected?.id === r.id}>
              {r.name}
            </FilterPill>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No upcoming retreats right now. Check back soon.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((event) => {
            const spots = retreatSpotsLabel(
              event.capacity == null ? null : (computeSpotsLeft(event.capacity, event.spots_taken) ?? 0),
            );
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
                        <RegionTag region={regionName(event.region_id, regions)} />
                        {spots}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function RetreatsPage({ searchParams }: { searchParams: Promise<{ region?: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6 md:p-10">
      <div>
        <h1 className="text-2xl font-bold">Retreats</h1>
        <p className="text-sm text-muted-foreground">Upcoming Fishing the Good Fight retreats. Open one for the details.</p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <RetreatList searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
