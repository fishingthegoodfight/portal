import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { toZonedDateTimeInputs } from "@/lib/timezone";
import { CHAPTERS, timezoneForChapter, VIRTUAL_CHAPTER } from "@/lib/chapters";
import { loadManageableChapters } from "@/lib/admin/require-admin";
import { WAIVER_STATES, waiverStateForChapter } from "@/lib/waivers";
import { loadActiveRoles, toEditableRole } from "@/lib/admin/event-roles";
import { EventEditForm } from "@/components/admin/event-edit-form";
import type { EventTypeOption } from "@/lib/event-types";
import { getSiteUrl } from "@/lib/site-url";
import { VENUE_COLUMNS, type Venue } from "@/lib/venues";

async function EventEditLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) {
    notFound();
  }

  const supabase = await createClient();
  const [
    { data: event },
    { data: eventTypes },
    { data: roleTypes },
    roles,
    allowedChapters,
    { data: venues },
  ] = await Promise.all([
    supabase
      .from("events")
      .select(
        "id, slug, name, event_type, series_id, description, occurrence_note, location, venue_name, street_address, city, state, postal_code, virtual_link, virtual_access_notes, capacity, lead_name, lead_user_id, lead_phone, lead_email, custom_email_note, registration_sections, starts_at, ends_at, timezone, chapter, status, waiver_state, marketing_tier, requires_health_history",
      )
      .eq("id", eventId)
      .maybeSingle(),
    // Active AND inactive — an already-deactivated type stays selectable on
    // an event that already has it (see EventTypeField).
    supabase
      .from("event_types")
      .select("id, key, name, default_registration_sections, requires_health_history, sort_order, active")
      .order("sort_order", { ascending: true }),
    supabase
      .from("volunteer_role_types")
      .select("id, name, for_chapter_events, for_retreats, active")
      .order("sort_order", { ascending: true }),
    loadActiveRoles(supabase, [eventId]),
    loadManageableChapters(supabase, [...CHAPTERS.map((c) => c.name), VIRTUAL_CHAPTER]),
    supabase.from("venues").select(VENUE_COLUMNS).eq("active", true).order("name", { ascending: true }),
  ]);

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

  // Active role types plus any a role here already uses, so saving never
  // silently drops it; the form narrows them to what the event offers
  // (roleTypesForEvent — retreat roles only when it requires health history).
  const usedRoleTypeIds = new Set(roles.map((r) => r.role_type_id));
  const roleTypeOptions = (roleTypes ?? [])
    .filter((rt) => rt.active || usedRoleTypeIds.has(rt.id as number))
    .map((rt) => ({
      id: rt.id as number,
      name: rt.name as string,
      for_chapter_events: Boolean(rt.for_chapter_events),
      for_retreats: Boolean(rt.for_retreats),
    }));

  return (
    <EventEditForm
      eventId={event.id}
      publicUrlBase={`${getSiteUrl()}/events/`}
      isCancelled={event.status === "cancelled"}
      seriesId={event.series_id}
      eventTypes={(eventTypes ?? []) as EventTypeOption[]}
      roleTypes={roleTypeOptions}
      signedUpByRoleId={Object.fromEntries(roles.map((r) => [r.id, r.confirmed]))}
      allowedChapters={allowedChapters}
      venues={(venues ?? []) as Venue[]}
      legacyLocation={
        !event.venue_name && !event.street_address && !event.city && !event.state && !event.postal_code
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
        slug: event.slug ?? "",
        eventType: event.event_type ?? "",
        chapter: event.chapter ?? "",
        description: event.description ?? "",
        occurrenceNote: event.occurrence_note ?? "",
        venueName: event.venue_name ?? "",
        streetAddress: event.street_address ?? "",
        city: event.city ?? "",
        state: event.state ?? "",
        postalCode: event.postal_code ?? "",
        virtualLink: event.virtual_link ?? "",
        virtualAccessNotes: event.virtual_access_notes ?? "",
        capacity: event.capacity != null ? String(event.capacity) : "",
        leadName: event.lead_name ?? "",
        leadPhone: event.lead_phone ?? "",
        leadEmail: event.lead_email ?? "",
        leadUserId: event.lead_user_id ?? "",
        customEmailNote: event.custom_email_note ?? "",
        registrationSections: event.registration_sections ?? [],
        requiresHealthHistory: event.requires_health_history === true,
        date,
        time,
        endTime,
        timezone,
        volunteerRoles: roles.map((r) => toEditableRole(r, timezone)),
        boostTier1: event.marketing_tier === 1,
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
