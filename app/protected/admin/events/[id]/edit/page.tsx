import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { toZonedDateTimeInputs } from "@/lib/timezone";
import { timezoneForChapter } from "@/lib/chapters";
import { WAIVER_STATES, waiverStateForChapter } from "@/lib/waivers";
import { EventEditForm } from "@/components/admin/event-edit-form";

async function EventEditLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) {
    notFound();
  }

  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select(
      "id, name, description, location, venue_name, street_address, city, state, capacity, lead_name, lead_phone, lead_email, custom_email_note, registration_sections, starts_at, ends_at, timezone, chapter, status, waiver_state",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (!event) {
    notFound();
  }

  // event.timezone is `not null default 'America/Denver'`, so this fallback
  // is defensive rather than something normal data should ever hit.
  const timezone = event.timezone || timezoneForChapter(event.chapter);
  const { date, time } = toZonedDateTimeInputs(new Date(event.starts_at), timezone);
  const endTime = event.ends_at
    ? toZonedDateTimeInputs(new Date(event.ends_at), timezone).time
    : "";

  return (
    <EventEditForm
      eventId={event.id}
      isCancelled={event.status === "cancelled"}
      legacyLocation={
        !event.venue_name && !event.street_address && !event.city && !event.state
          ? event.location
          : null
      }
      waiverLabel={
        (() => {
          const state = waiverStateForChapter(event.chapter);
          return state ? WAIVER_STATES[state] : null;
        })()
      }
      initial={{
        name: event.name,
        chapter: event.chapter ?? "",
        description: event.description ?? "",
        venueName: event.venue_name ?? "",
        streetAddress: event.street_address ?? "",
        city: event.city ?? "",
        state: event.state ?? "",
        capacity: event.capacity != null ? String(event.capacity) : "",
        leadName: event.lead_name ?? "",
        leadPhone: event.lead_phone ?? "",
        leadEmail: event.lead_email ?? "",
        customEmailNote: event.custom_email_note ?? "",
        registrationSections: event.registration_sections ?? [],
        date,
        time,
        endTime,
        timezone,
      }}
    />
  );
}

export default function EventEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-lg">
      <div>
        <h1 className="font-bold text-2xl mb-1">Edit event</h1>
        <p className="text-sm text-muted-foreground">
          Date and time are entered in whichever zone you pick — no UTC math
          needed.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <EventEditLoader params={params} />
      </Suspense>
    </div>
  );
}
