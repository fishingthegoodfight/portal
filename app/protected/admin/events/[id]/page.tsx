import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadEventRoster } from "@/lib/admin/roster";
import { formatEventDateRange } from "@/lib/format-date";
import { EventRoster } from "@/components/admin/event-roster";

async function AdminEventLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) {
    notFound();
  }

  const supabase = await createClient();
  const data = await loadEventRoster(supabase, eventId);
  if (!data) {
    notFound();
  }
  const { event, roster, waitlist } = data;
  const offeredCount = waitlist.filter((w) => w.status === "offered").length;

  return (
    <EventRoster
      eventId={event.id}
      eventCard={{
        id: event.id,
        name: event.name,
        chapter: event.chapter,
        location: event.location,
        description: event.description,
        dateRange: formatEventDateRange(event.starts_at, event.ends_at, event.timezone),
        capacity: event.capacity,
        // Open offers hold a spot, so count them as taken on the card.
        spots_taken: (event.spots_taken ?? 0) + offeredCount,
      }}
      status={event.status}
      cancellationReason={event.cancellation_reason}
      initialRoster={roster}
      initialWaitlist={waitlist}
    />
  );
}

export default function AdminEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Event roster</h1>
        <p className="text-sm text-muted-foreground">
          Check people in, add walk-ups, manage the waitlist, and print a roster.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <AdminEventLoader params={params} />
      </Suspense>
    </div>
  );
}
