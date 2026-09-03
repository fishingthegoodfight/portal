import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type EventCardEvent = {
  id: number;
  name: string;
  chapter: string | null;
  location: string | null;
  description: string | null;
  /** Pre-formatted (see lib/format-date.ts) by the server loader — see the
   * comment on RsvpForm's EventSummary type for why this isn't formatted here. */
  dateRange: string;
  capacity: number | null;
  spots_taken: number | null;
};

/**
 * The event summary card used everywhere an event is shown: the events list
 * and the top of the RSVP page. Keeping one component means status pill,
 * spots-left, and the "going / waitlisted" left border always match.
 */
export function EventCard({
  event,
  rsvpStatus,
  action,
}: {
  event: EventCardEvent;
  /** The caller's own RSVP status for this event, if any. */
  rsvpStatus: string | null;
  /** Footer call-to-action, e.g. a "RSVP" / "View / Change RSVP" button. Omit
   * on the RSVP page itself, where a link back to the page you're on would
   * be redundant. */
  action?: ReactNode;
}) {
  const hasActiveRsvp = rsvpStatus != null && rsvpStatus !== "cancelled";
  const waitlisted = rsvpStatus === "waitlisted";
  const spotsLeft =
    event.capacity != null && event.spots_taken != null
      ? event.capacity - event.spots_taken
      : null;
  const isFull = spotsLeft != null && spotsLeft <= 0 && !hasActiveRsvp;

  const statusPill = hasActiveRsvp
    ? waitlisted
      ? { label: "Waitlisted", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" }
      : { label: "Going", tone: "bg-green-600/15 text-green-700 dark:text-green-500" }
    : isFull
      ? { label: "Full", tone: "bg-muted text-muted-foreground" }
      : null;

  // Shown whenever there's genuine capacity left — including when you're
  // already "Going" (handy for nudging others). Hidden for waitlisted, since
  // spots_taken >= capacity there would read "0 spots left".
  const spotsLeftLabel =
    !waitlisted && spotsLeft != null && spotsLeft > 0
      ? `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`
      : null;

  return (
    <Card
      className={cn(
        hasActiveRsvp &&
          (waitlisted
            ? "border-l-4 border-l-amber-500"
            : "border-l-4 border-l-green-600"),
      )}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{event.name}</CardTitle>
            <CardDescription>
              {event.dateRange}
              {event.location ? ` · ${event.location}` : ""}
            </CardDescription>
          </div>
          {/* Chapter lives here (not on the location line, where it's
            * redundant after the address) so it stays visible when the
            * address is elsewhere or missing. */}
          <div className="flex shrink-0 flex-col items-end gap-1 text-right">
            {statusPill && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  statusPill.tone,
                )}
              >
                {statusPill.label}
              </span>
            )}
            {event.chapter && (
              <span className="text-xs text-muted-foreground">
                {event.chapter} chapter
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      {event.description && (
        <CardContent>
          <p className="text-sm text-muted-foreground">{event.description}</p>
        </CardContent>
      )}
      {(action || spotsLeftLabel) && (
        <CardFooter className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {spotsLeftLabel}
          </span>
          {action}
        </CardFooter>
      )}
    </Card>
  );
}
