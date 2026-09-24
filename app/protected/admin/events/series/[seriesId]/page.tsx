import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadManagedEventIds } from "@/lib/admin/require-admin";
import { formatEventDateRange } from "@/lib/format-date";
import { EMPTY_PEOPLE, isEmptyOccurrence, peopleByEvent } from "@/lib/admin/series";
import { SeriesOccurrences, type SeriesOccurrence } from "@/components/admin/series-occurrences";

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every other week",
  monthly: "Monthly, same weekday",
};

async function SeriesLoader({ params }: { params: Promise<{ seriesId: string }> }) {
  const { seriesId } = await params;

  const supabase = await createClient();
  // Only the occurrences this person manages (can_manage_event) — a chapter
  // lead can read other chapters' published events, but not manage them.
  const managed = await loadManagedEventIds(supabase);
  const { data: rows } = await supabase
    .from("events")
    .select("id, name, starts_at, ends_at, timezone, status, capacity, recurrence_frequency")
    .eq("series_id", seriesId)
    .order("starts_at", { ascending: true });
  const allEvents = (rows ?? []) as {
    id: number;
    name: string;
    starts_at: string;
    ends_at: string | null;
    timezone: string;
    status: string;
    capacity: number | null;
    recurrence_frequency: string | null;
  }[];
  const events = allEvents.filter((e) => managed.has(e.id));
  if (events.length === 0) notFound();

  const people = await peopleByEvent(
    supabase,
    events.map((e) => e.id),
  );
  // eslint-disable-next-line react-hooks/purity -- Server Component: renders once per request on the server (after awaiting request data), so there's no re-render or hydration to disagree with this timestamp.
  const now = Date.now();
  const occurrences: SeriesOccurrence[] = events.map((e) => {
    const p = people.get(e.id) ?? EMPTY_PEOPLE;
    return {
      id: e.id,
      name: e.name,
      dateRange: formatEventDateRange(e.starts_at, e.ends_at, e.timezone),
      status: e.status,
      isPast: new Date(e.starts_at).getTime() <= now,
      capacity: e.capacity,
      people: p,
      isEmpty: isEmptyOccurrence(p),
    };
  });

  const frequency = events[0].recurrence_frequency;

  return (
    <SeriesOccurrences
      seriesId={seriesId}
      // The next upcoming occurrence's title (a series-wide rename reaches
      // forward, not back), or the last one's once they're all past.
      seriesName={(occurrences.find((o) => !o.isPast) ?? occurrences[occurrences.length - 1]).name}
      frequencyLabel={frequency ? (FREQUENCY_LABELS[frequency] ?? frequency) : null}
      occurrences={occurrences}
    />
  );
}

export default function SeriesPage({ params }: { params: Promise<{ seriesId: string }> }) {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-3xl">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <SeriesLoader params={params} />
      </Suspense>
    </div>
  );
}
