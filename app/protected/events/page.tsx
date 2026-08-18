import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatEventDateRange } from "@/lib/format-date";

async function EventsListLoader() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select(
      "id, name, chapter, event_type, starts_at, ends_at, location, description, capacity, spots_taken",
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

  return (
    <div className="flex flex-col gap-4">
      {events.map((event) => {
        const spotsLeft =
          event.capacity != null && event.spots_taken != null
            ? event.capacity - event.spots_taken
            : null;
        const isFull = spotsLeft != null && spotsLeft <= 0;

        return (
          <Card key={event.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>{event.name}</CardTitle>
                  <CardDescription>
                    {formatEventDateRange(event.starts_at, event.ends_at)}
                    {event.location ? ` · ${event.location}` : ""}
                  </CardDescription>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {event.chapter && (
                    <Badge variant="secondary">{event.chapter}</Badge>
                  )}
                  {event.event_type && (
                    <Badge variant="outline">{event.event_type}</Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            {event.description && (
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {event.description}
                </p>
              </CardContent>
            )}
            <CardFooter className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {spotsLeft != null
                  ? isFull
                    ? "Full"
                    : `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`
                  : null}
              </span>
              {isFull ? (
                <Button disabled variant="secondary">
                  Full
                </Button>
              ) : (
                <Button asChild>
                  <Link href={`/protected/events/${event.id}/rsvp`}>RSVP</Link>
                </Button>
              )}
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}

export default function EventsPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
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
        <EventsListLoader />
      </Suspense>
    </div>
  );
}
