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
    .select("chapter")
    .eq("id", userId)
    .maybeSingle();

  // An explicit `?chapter=` wins; otherwise fall back to the member's own
  // chapter (or "All" if they have none).
  const activeFilter =
    chapterFilterBySlug(chapterParam) ??
    chapterFilterBySlug(defaultChapterFilterSlug(profile?.chapter)) ??
    CHAPTER_FILTERS[0];

  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select(
      "id, name, chapter, event_type, starts_at, ends_at, timezone, location, description, capacity, spots_taken",
    )
    .eq("is_published", true)
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

  // RLS scopes rsvps to the caller's own rows, so this is just "my RSVPs
  // for the events on this page" without needing an explicit user_id filter.
  const { data: rsvps } = await supabase
    .from("rsvps")
    .select("event_id, status")
    .in(
      "event_id",
      shownEvents.map((event) => event.id),
    );
  const rsvpStatusByEvent = new Map(
    (rsvps ?? []).map((rsvp) => [rsvp.event_id, rsvp.status]),
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
          const spotsLeft =
            event.capacity != null && event.spots_taken != null
              ? event.capacity - event.spots_taken
              : null;
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
                dateRange: formatEventDateRange(
                  event.starts_at,
                  event.ends_at,
                  event.timezone,
                ),
                capacity: event.capacity,
                spots_taken: event.spots_taken,
              }}
              rsvpStatus={rsvpStatus}
              action={
                hasActiveRsvp ? (
                  <Button asChild variant="outline">
                    <Link href={`/protected/events/${event.id}/rsvp`}>
                      View / Change RSVP
                    </Link>
                  </Button>
                ) : isFull ? (
                  <Button disabled variant="secondary">
                    Full
                  </Button>
                ) : (
                  <Button asChild>
                    <Link href={`/protected/events/${event.id}/rsvp`}>
                      RSVP
                    </Link>
                  </Button>
                )
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
