import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadEventRoster } from "@/lib/admin/roster";
import { countSignupsCancelledWithEvent } from "@/lib/admin/event-roles";
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
  const { event, roster, waitlist, waiver, dietary, volunteerRoles, volunteerRoster } = data;
  const offeredCount = waitlist.filter((w) => w.status === "offered").length;
  // Only needed for the restore dialog — shifts don't come back on restore.
  const volunteersCancelledWithEvent =
    event.status === "cancelled"
      ? await countSignupsCancelledWithEvent(supabase, event.id, event.cancelled_at)
      : 0;

  return (
    <EventRoster
      eventId={event.id}
      eventCard={{
        id: event.id,
        name: event.name,
        chapter: event.chapter,
        location: event.location,
        description: event.description,
        occurrenceNote: event.occurrence_note,
        dateRange: formatEventDateRange(event.starts_at, event.ends_at, event.timezone),
        capacity: event.capacity,
        // Open offers hold a spot, so count them as taken on the card.
        spots_taken: (event.spots_taken ?? 0) + offeredCount,
      }}
      virtualLink={event.virtual_link}
      virtualAccessNotes={event.virtual_access_notes}
      status={event.status}
      cancellationReason={event.cancellation_reason}
      initialRoster={roster}
      initialWaitlist={waitlist}
      waiver={waiver}
      dietary={dietary}
      registrationSectionIds={event.registration_sections ?? []}
      volunteerRoles={volunteerRoles}
      initialVolunteerRoster={volunteerRoster}
      seriesId={event.series_id}
      volunteersCancelledWithEvent={volunteersCancelledWithEvent}
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
