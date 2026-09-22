import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { RsvpForm } from "@/components/rsvp-form";
import { EventCard } from "@/components/event-card";
import { VolunteerSignupSection, type EligibleVolunteerRole } from "@/components/volunteer-signup-section";
import { Button } from "@/components/ui/button";
import { formatEventDateRange, formatEventInstant } from "@/lib/format-date";
import { waiverInfoForUser, waiverInfoForVolunteerAtEvent, type WaiverInfo } from "@/lib/waivers";
import {
  approvedRoleTypeIds,
  eligibleOpportunities,
  isApprovedVolunteer,
  type VolunteerOpportunity,
} from "@/lib/volunteer-signups";
import {
  profileValueFromColumn,
  REGISTRATION_SECTIONS,
} from "@/lib/registration-sections";

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
      "id, name, chapter, event_type, starts_at, ends_at, timezone, location, description, occurrence_note, capacity, spots_taken, is_published, registration_sections, status, cancellation_reason, waiver_state, virtual_link, virtual_access_notes",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (!event || !event.is_published) {
    notFound();
  }

  // A cancelled event may still be reached via an old link (e.g. the "View
  // event" button in a confirmation email sent before it was cancelled) —
  // show the cancellation instead of notFound(), since a confirmed attendee
  // landing here should see what happened, not a dead link.
  if (event.status === "cancelled") {
    return (
      <div className="flex flex-col gap-6">
        <EventCard
          event={{
            id: event.id,
            name: event.name,
            chapter: event.chapter,
            location: event.location,
            description: event.description,
            dateRange: formatEventDateRange(event.starts_at, event.ends_at, event.timezone),
            capacity: event.capacity,
            spots_taken: event.spots_taken,
            cancelled: true,
          }}
          rsvpStatus={null}
        />
        <p className="text-sm text-muted-foreground">
          This event has been cancelled
          {event.cancellation_reason ? `: ${event.cancellation_reason}` : "."}
        </p>
        <Button asChild variant="outline" className="w-fit">
          <Link href="/protected/events">Back to events</Link>
        </Button>
      </div>
    );
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
    .select("status, dietary_notes, offer_expires_at")
    .eq("event_id", eventId)
    // Explicit user filter: admins can read every RSVP (admin_select_all_rsvps),
    // so RLS alone would hand them someone else's row here.
    .eq("user_id", userId)
    .maybeSingle();

  // A lapsed offer isn't an active RSVP: the person can rejoin (at the back
  // of the line), so the form treats it as no RSVP plus a notice.
  const offerLapsed = existingRsvp?.status === "expired";
  const activeRsvp = existingRsvp && !offerLapsed ? existingRsvp : null;

  // Open offers hold a spot, so they count as taken for "is it full?" —
  // spots_taken alone only counts confirmed people.
  const [{ data: offeredCounts }, { data: waitlistPosition }] = await Promise.all([
    supabase.rpc("event_offered_counts", { p_event_ids: [eventId] }),
    activeRsvp?.status === "waitlisted"
      ? supabase.rpc("waitlist_position", { p_event_id: eventId })
      : Promise.resolve({ data: null }),
  ]);
  const offeredCount =
    ((offeredCounts ?? []) as { event_id: number; offered_count: number }[])[0]?.offered_count ?? 0;

  // The waiver isn't profile-backed: the server works out which one applies
  // to this event (state + year) and whether this user has signed it.
  const waiver = await waiverInfoForUser(supabase, event, userId);

  // Volunteer signups are independent of RSVPing — computed regardless of
  // activeRsvp above. Only rendered at all when the event actually has
  // volunteer roles (see lib/volunteer-signups.ts).
  const { data: opportunities } = await supabase
    .from("volunteer_opportunities")
    .select(
      "id, event_id, role, description, what_to_bring, role_type_id, shift_start, shift_end, slots, slots_taken",
    )
    .eq("event_id", eventId);

  let volunteerSection: React.ReactNode = null;
  if (opportunities && opportunities.length > 0) {
    const approvedVolunteer = await isApprovedVolunteer(supabase, userId);
    let eligibleRoles: EligibleVolunteerRole[] = [];
    let volunteerWaiver: WaiverInfo = { status: "unavailable", message: "" };

    if (approvedVolunteer) {
      const approvedTypes = await approvedRoleTypeIds(supabase, userId);
      const eligible = eligibleOpportunities(opportunities as VolunteerOpportunity[], approvedTypes);

      const { data: signups } = await supabase
        .from("volunteer_signups")
        .select("opportunity_id, status")
        .eq("user_id", userId)
        .in(
          "opportunity_id",
          eligible.map((o) => o.id),
        );
      const signedUpIds = new Set(
        (signups ?? [])
          .filter((s) => s.status === "confirmed")
          .map((s) => s.opportunity_id as number),
      );

      eligibleRoles = eligible.map((o) => ({
        id: o.id,
        role: o.role,
        description: o.description,
        whatToBring: o.what_to_bring,
        shiftDateRange: formatEventDateRange(o.shift_start, o.shift_end, event.timezone),
        spotsRemaining: Math.max(o.slots - o.slots_taken, 0),
        signedUp: signedUpIds.has(o.id),
      }));

      volunteerWaiver = await waiverInfoForVolunteerAtEvent(supabase, event, userId);
    }

    volunteerSection = (
      <VolunteerSignupSection
        eventId={event.id}
        isApprovedVolunteer={approvedVolunteer}
        eligibleRoles={eligibleRoles}
        waiver={volunteerWaiver}
      />
    );
  }

  // Every registration field's current value, keyed by its profile column —
  // formatted (e.g. the phone mask) in case a stored value predates that
  // formatting, same as the profile page does for its own initial values.
  const profileFields: Record<string, string> = {};
  for (const section of REGISTRATION_SECTIONS) {
    for (const field of section.fields) {
      profileFields[field.key] = profileValueFromColumn(field, profile?.[field.key]);
    }
  }

  return (
    <div className="flex flex-col gap-8">
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
        occurrenceNote: event.occurrence_note,
        capacity: event.capacity,
        spots_taken: (event.spots_taken ?? 0) + offeredCount,
        registration_sections: event.registration_sections ?? [],
        // Only ever sent to the browser for a confirmed RSVP — never
        // publicly, and never for waitlisted/offered (see the matching rule
        // in lib/email/send.ts for the email side of this).
        virtualLink: activeRsvp?.status === "confirmed" ? event.virtual_link : null,
        virtualAccessNotes: activeRsvp?.status === "confirmed" ? event.virtual_access_notes : null,
      }}
      profile={{
        first_name: profile?.first_name ?? "",
        last_name: profile?.last_name ?? "",
        email: profile?.email ?? "",
        phone: profile?.phone ?? "",
      }}
      profileFields={profileFields}
      initialRsvp={
        activeRsvp
          ? {
              status: activeRsvp.status,
              dietaryNotes: activeRsvp.dietary_notes ?? "",
            }
          : null
      }
      waitlistPosition={typeof waitlistPosition === "number" ? waitlistPosition : null}
      offerExpiresLabel={
        activeRsvp?.status === "offered" && activeRsvp.offer_expires_at
          ? formatEventInstant(activeRsvp.offer_expires_at, event.timezone)
          : null
      }
      offerLapsed={offerLapsed}
      waiver={waiver}
    />
    {volunteerSection}
    </div>
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
