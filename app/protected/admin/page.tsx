import Link from "next/link";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { EventCard } from "@/components/event-card";
import { Button } from "@/components/ui/button";
import { formatEventDateRange } from "@/lib/format-date";

async function AdminEventsLoader() {
  const supabase = await createClient();
  const { data: events, error } = await supabase
    .from("events")
    .select(
      "id, name, chapter, starts_at, ends_at, timezone, location, description, capacity, spots_taken, status",
    )
    .order("starts_at", { ascending: false });

  if (error) {
    return (
      <p className="text-sm text-red-500">Couldn&apos;t load events: {error.message}</p>
    );
  }

  if (!events || events.length === 0) {
    return <p className="text-sm text-muted-foreground">No events yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {events.map((event) => (
        <EventCard
          key={event.id}
          event={{
            id: event.id,
            name: event.name,
            chapter: event.chapter,
            location: event.location,
            description: event.description,
            dateRange: formatEventDateRange(event.starts_at, event.ends_at, event.timezone),
            capacity: event.capacity,
            spots_taken: event.spots_taken,
            cancelled: event.status === "cancelled",
          }}
          rsvpStatus={null}
          action={
            <Button asChild variant="outline">
              <Link href={`/protected/admin/events/${event.id}`}>Manage</Link>
            </Button>
          }
        />
      ))}
    </div>
  );
}

/**
 * The header's "Admin" link lands here. Deliberately shows every event —
 * cancelled and past included, not just the published/scheduled/upcoming
 * ones the participant list (app/protected/events) filters to — since this
 * is the only place a "Manage" link to a cancelled event exists, and
 * restoring one requires reaching it first.
 */
export default function AdminEventsIndexPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-2xl mb-1">Manage events</h1>
          <p className="text-sm text-muted-foreground">
            Every event, including cancelled and past ones.
          </p>
        </div>
        <Button asChild>
          <Link href="/protected/admin/events/new">New event</Link>
        </Button>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <AdminEventsLoader />
      </Suspense>
    </div>
  );
}
