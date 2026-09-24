import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { EventCard } from "@/components/event-card";
import { formatEventDateRange } from "@/lib/format-date";
import {
  chapterSelectionLabel,
  chapterSelectionParam,
  matchesChapterSelection,
  memberDefaultChapterSelection,
  parseChapterSelection,
  type ChapterSelection,
} from "@/lib/chapters";
import { ChapterFilterPills, FilterPill, filterHref } from "@/components/filter-pills";
import { isApprovedVolunteer, loadOpenShiftsForVolunteer } from "@/lib/volunteer-signups";
import { loadManagedEventIds } from "@/lib/admin/require-admin";

async function ConfirmationBannerLoader({
  searchParams,
}: {
  searchParams: Promise<{ rsvp?: string; event?: string }>;
}) {
  const { rsvp, event } = await searchParams;
  if (!rsvp) return null;

  const cancelled = rsvp === "cancelled";
  const message = cancelled
    ? `RSVP cancelled${event ? ` for ${event}` : ""}.`
    : rsvp === "waitlisted"
      ? `You're waitlisted${event ? ` for ${event}` : ""}.`
      : `You're RSVP'd${event ? ` for ${event}` : ""}.`;

  return (
    <div className="bg-accent text-sm p-3 px-5 rounded-md text-foreground flex gap-3 items-center">
      {cancelled ? (
        <XCircle size={16} strokeWidth={2} />
      ) : (
        <CheckCircle2 size={16} strokeWidth={2} />
      )}
      {message}
    </div>
  );
}

/** Chapter pills, plus — for approved volunteers only — a "Needs volunteers"
 * toggle that combines with whichever chapters are selected. */
function EventsFilterBar({
  selection,
  showVolunteerFilter,
  needsVolunteers,
}: {
  selection: ChapterSelection;
  showVolunteerFilter: boolean;
  needsVolunteers: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <ChapterFilterPills
        selection={selection}
        basePath="/protected/events"
        otherParams={{ volunteers: needsVolunteers ? "1" : undefined }}
      />
      {showVolunteerFilter && (
        <div>
          <FilterPill
            href={filterHref("/protected/events", {
              chapter: chapterSelectionParam(selection),
              volunteers: needsVolunteers ? undefined : "1",
            })}
            active={needsVolunteers}
          >
            Needs volunteers
          </FilterPill>
        </div>
      )}
    </div>
  );
}

async function EventsListLoader({
  searchParams,
}: {
  searchParams: Promise<{ chapter?: string; volunteers?: string }>;
}) {
  const { chapter: chapterParam, volunteers: volunteersParam } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  const userId = data.claims.sub as string;

  const { data: profile } = await supabase
    .from("profiles")
    .select("chapter")
    .eq("id", userId)
    .maybeSingle();
  // "Manage" shows on exactly the events this person can manage
  // (can_manage_event) — every event for an admin, their chapters' for a
  // chapter lead, the ones they lead for an event lead.
  const managedEventIds = await loadManagedEventIds(supabase);

  // An explicit `?chapter=` wins; otherwise the member's own chapter plus
  // Virtual (or All if they have no local chapter).
  const selection = parseChapterSelection(
    chapterParam,
    memberDefaultChapterSelection(profile?.chapter),
  );

  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select(
      "id, name, chapter, event_type, starts_at, ends_at, timezone, location, description, occurrence_note, capacity, spots_taken",
    )
    .eq("is_published", true)
    .eq("status", "scheduled")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true });

  if (eventsError) {
    return (
      <p className="text-sm text-red-500">
        Couldn&apos;t load events: {eventsError.message}
      </p>
    );
  }

  if (!events || events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No upcoming events right now — check back soon.
      </p>
    );
  }

  const chapterEvents = events.filter((event) => matchesChapterSelection(selection, event.chapter));

  // Approved volunteers only: events with an open shift in a role they're
  // approved for — the "Needs volunteers" badge and filter.
  const isVolunteer = await isApprovedVolunteer(supabase, userId);
  const openShifts = isVolunteer
    ? await loadOpenShiftsForVolunteer(supabase, userId, {
        eventIds: chapterEvents.map((event) => event.id),
      })
    : [];
  const needsVolunteerIds = new Set(openShifts.map((shift) => shift.event.id));
  const needsVolunteersFilter = isVolunteer && volunteersParam === "1";
  const shownEvents = needsVolunteersFilter
    ? chapterEvents.filter((event) => needsVolunteerIds.has(event.id))
    : chapterEvents;

  // Filter by user_id explicitly: RLS alone isn't enough, because admins have
  // a policy (admin_select_all_rsvps) that lets them read EVERYONE's rows —
  // without this an admin sees other people's RSVPs as their own.
  const { data: rsvps } = await supabase
    .from("rsvps")
    .select("event_id, status")
    .eq("user_id", userId)
    .in(
      "event_id",
      shownEvents.map((event) => event.id),
    );
  // A lapsed offer ('expired') is no longer an active RSVP — treat it as none.
  const rsvpStatusByEvent = new Map(
    (rsvps ?? [])
      .filter((rsvp) => rsvp.status !== "expired")
      .map((rsvp) => [rsvp.event_id, rsvp.status]),
  );

  // Open offers hold a spot but aren't in events.spots_taken, so fold them
  // in — otherwise an event whose last spot is on offer would look open.
  const { data: offeredCounts } = await supabase.rpc("event_offered_counts", {
    p_event_ids: shownEvents.map((event) => event.id),
  });
  const offeredByEvent = new Map(
    ((offeredCounts ?? []) as { event_id: number; offered_count: number }[]).map((row) => [
      row.event_id,
      row.offered_count,
    ]),
  );

  return (
    <div className="flex flex-col gap-4">
      <EventsFilterBar
        selection={selection}
        showVolunteerFilter={isVolunteer}
        needsVolunteers={needsVolunteersFilter}
      />

      {shownEvents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {needsVolunteersFilter
            ? `No upcoming events for ${chapterSelectionLabel(selection)} need volunteers in your roles right now.`
            : `No upcoming events for ${chapterSelectionLabel(selection)}.`}
        </p>
      ) : (
        shownEvents.map((event) => {
          const rsvpStatus = rsvpStatusByEvent.get(event.id) ?? null;
          const hasActiveRsvp =
            rsvpStatus != null && rsvpStatus !== "cancelled";
          const spotsTaken =
            event.spots_taken != null
              ? event.spots_taken + (offeredByEvent.get(event.id) ?? 0)
              : null;
          const spotsLeft =
            event.capacity != null && spotsTaken != null ? event.capacity - spotsTaken : null;
          const isFull = spotsLeft != null && spotsLeft <= 0 && !hasActiveRsvp;

          return (
            <EventCard
              key={event.id}
              event={{
                id: event.id,
                name: event.name,
                chapter: event.chapter,
                location: event.location,
                description: event.description,
                occurrenceNote: event.occurrence_note,
                dateRange: formatEventDateRange(
                  event.starts_at,
                  event.ends_at,
                  event.timezone,
                ),
                capacity: event.capacity,
                spots_taken: spotsTaken,
                needsVolunteers: needsVolunteerIds.has(event.id),
              }}
              rsvpStatus={rsvpStatus}
              action={
                <div className="flex gap-2">
                  {managedEventIds.has(event.id) && (
                    <Button asChild variant="outline">
                      <Link href={`/protected/admin/events/${event.id}`}>
                        Manage
                      </Link>
                    </Button>
                  )}
                  {rsvpStatus === "offered" ? (
                    <Button asChild>
                      <Link href={`/protected/events/${event.id}/rsvp`}>
                        Claim your spot
                      </Link>
                    </Button>
                  ) : hasActiveRsvp ? (
                    <Button asChild variant="outline">
                      <Link href={`/protected/events/${event.id}/rsvp`}>
                        View / Change RSVP
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild>
                      <Link href={`/protected/events/${event.id}/rsvp`}>
                        {isFull ? "Join waitlist" : "RSVP"}
                      </Link>
                    </Button>
                  )}
                </div>
              }
            />
          );
        })
      )}
    </div>
  );
}

export default function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ rsvp?: string; event?: string; chapter?: string; volunteers?: string }>;
}) {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <Suspense fallback={null}>
        <ConfirmationBannerLoader searchParams={searchParams} />
      </Suspense>
      <div>
        <h1 className="font-bold text-2xl mb-1">Upcoming events</h1>
        <p className="text-sm text-muted-foreground">
          Published, upcoming events. RSVP below for the ones you can make.
        </p>
      </div>
      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">Loading...</p>
        }
      >
        <EventsListLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
