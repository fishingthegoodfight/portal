import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { RsvpForm } from "@/components/rsvp-form";
import { formatEventDateRange } from "@/lib/format-date";
import { REGISTRATION_SECTIONS } from "@/lib/registration-sections";

async function RsvpLoader({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) {
    notFound();
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  const userId = data.claims.sub as string;

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, name, chapter, event_type, starts_at, ends_at, timezone, location, description, capacity, spots_taken, is_published, registration_sections",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (!event || !event.is_published) {
    notFound();
  }

  // select("*") rather than an explicit column list so a new registration
  // section's profile column (see lib/registration-sections.ts) is picked up
  // here automatically, with no loader edit needed.
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  const { data: existingRsvp } = await supabase
    .from("rsvps")
    .select("status, dietary_notes")
    .eq("event_id", eventId)
    .maybeSingle();

  // Every registration field's current value, keyed by its profile column —
  // formatted (e.g. the phone mask) in case a stored value predates that
  // formatting, same as the profile page does for its own initial values.
  const profileFields: Record<string, string> = {};
  for (const section of REGISTRATION_SECTIONS) {
    for (const field of section.fields) {
      const raw = (profile?.[field.key] as string | null) ?? "";
      profileFields[field.key] = field.format ? field.format(raw) : raw;
    }
  }

  return (
    <RsvpForm
      userId={userId}
      event={{
        id: event.id,
        name: event.name,
        chapter: event.chapter,
        event_type: event.event_type,
        dateRange: formatEventDateRange(
          event.starts_at,
          event.ends_at,
          event.timezone,
        ),
        location: event.location,
        description: event.description,
        capacity: event.capacity,
        spots_taken: event.spots_taken,
        registration_sections: event.registration_sections ?? [],
      }}
      profile={{
        first_name: profile?.first_name ?? "",
        last_name: profile?.last_name ?? "",
        email: profile?.email ?? "",
        phone: profile?.phone ?? "",
      }}
      profileFields={profileFields}
      initialRsvp={
        existingRsvp
          ? {
              status: existingRsvp.status,
              dietaryNotes: existingRsvp.dietary_notes ?? "",
            }
          : null
      }
    />
  );
}

export default function EventRsvpPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-lg">
      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">Loading...</p>
        }
      >
        <RsvpLoader params={params} />
      </Suspense>
    </div>
  );
}
