import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { EventCard } from "@/components/event-card";
import { formatEventDateRange } from "@/lib/format-date";
import {
  CHAPTER_FILTERS,
  chapterFilterBySlug,
  defaultChapterFilterSlug,
} from "@/lib/chapters";
import { cn } from "@/lib/utils";

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

function ChapterFilterBar({ activeSlug }: { activeSlug: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {CHAPTER_FILTERS.map((filter) => {
        const active = filter.slug === activeSlug;
        return (
          <Link
            key={filter.slug}
            href={`/protected/events?chapter=${filter.slug}`}
            aria-current={active ? "true" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              active
                ? "border-transparent bg-foreground text-background"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {filter.label}
          </Link>
        );
      })}
    </div>
  );
}

async function EventsListLoader({
  searchParams,
}: {
  searchParams: Promise<{ chapter?: string }>;
}) {
  const { chapter: chapterParam } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  const userId = data.claims.sub as string;

  const { data: profile } = await supabase
    .from("profiles")
    .select("chapter, is_admin")
    .eq("id", userId)
    .maybeSingle();
  const isAdmin = profile?.is_admin ?? false;

  // An explicit `?chapter=` wins; otherwise fall back to the member's own
  // chapter (or "All" if they have none).
  const activeFilter =
    chapterFilterBySlug(chapterParam) ??
    chapterFilterBySlug(defaultChapterFilterSlug(profile?.chapter)) ??
    CHAPTER_FILTERS[0];

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

  const shownEvents = activeFilter.chapters
    ? events.filter((event) =>
        activeFilter.chapters!.includes(event.chapter ?? ""),
      )
    : events;

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
      <ChapterFilterBar activeSlug={activeFilter.slug} />

      {shownEvents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No upcoming events for {activeFilter.label}.
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
              }}
              rsvpStatus={rsvpStatus}
              action={
                <div className="flex gap-2">
                  {isAdmin && (
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
  searchParams: Promise<{ rsvp?: string; event?: string; chapter?: string }>;
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
