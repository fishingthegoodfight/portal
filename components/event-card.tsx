import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChapterTag } from "@/components/chapter-tag";
import { cn } from "@/lib/utils";
import { spotsLeft as computeSpotsLeft } from "@/lib/event-capacity";

export type EventCardEvent = {
  id: number;
  name: string;
  chapter: string | null;
  location: string | null;
  description: string | null;
  /** A short public note for this specific occurrence (events.occurrence_note)
   * — distinct from description (the event's standing description) and never
   * pre-filled by a template. Shown directly under the description, styled
   * apart from it. */
  occurrenceNote?: string | null;
  /** Pre-formatted (see lib/format-date.ts) by the server loader — see the
   * comment on RsvpForm's EventSummary type for why this isn't formatted here. */
  dateRange: string;
  capacity: number | null;
  spots_taken: number | null;
  /** True once the organizer has cancelled the event — overrides every
   * other status pill (Going/Waitlisted/Full) since none of those still
   * apply. Optional since most callers show only scheduled events. */
  cancelled?: boolean;
  /** Zoom/meeting link + access notes. Only ever set by a caller that has
   * already confirmed this viewer holds a confirmed RSVP (see the RSVP page
   * loader) — omitted entirely (not just falsy) everywhere else, so there's
   * nothing here to leak. */
  virtualLink?: string | null;
  virtualAccessNotes?: string | null;
  /** The viewer is an approved volunteer and this event has an open shift in
   * a role they're approved for (see loadOpenShiftsForVolunteer) — only ever
   * set on the events list. */
  needsVolunteers?: boolean;
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
  const offered = rsvpStatus === "offered";
  const spotsLeft = computeSpotsLeft(event.capacity, event.spots_taken);
  const isFull = spotsLeft != null && spotsLeft <= 0 && !hasActiveRsvp;

  const statusPill = event.cancelled
    ? { label: "Cancelled", tone: "bg-red-600/15 text-red-700 dark:text-red-400" }
    : hasActiveRsvp
      ? waitlisted
        ? { label: "Waitlisted", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" }
        : offered
          ? { label: "Spot offered", tone: "bg-blue-600/15 text-blue-700 dark:text-blue-400" }
          : { label: "Going", tone: "bg-green-600/15 text-green-700 dark:text-green-500" }
      : isFull
        ? { label: "Full", tone: "bg-muted text-muted-foreground" }
        : null;

  // Shown whenever there's genuine capacity left — including when you're
  // already "Going" (handy for nudging others). Hidden for waitlisted, since
  // spots_taken >= capacity there would read "0 spots left".
  const spotsLeftLabel =
    !waitlisted && !offered && spotsLeft != null && spotsLeft > 0
      ? `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`
      : null;

  return (
    <Card
      className={cn(
        hasActiveRsvp &&
          (waitlisted
            ? "border-l-4 border-l-amber-500"
            : offered
              ? "border-l-4 border-l-blue-600"
              : "border-l-4 border-l-green-600"),
      )}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <CardTitle>{event.name}</CardTitle>
            {/* The chapter sits with the rest of the event's metadata, as a
              * pill so it stays visible even when the location is missing —
              * the top-right is left for status pills. */}
            <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {event.chapter && <ChapterTag chapter={event.chapter} />}
              <span>
                {event.dateRange}
                {event.location ? ` · ${event.location}` : ""}
              </span>
            </CardDescription>
          </div>
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
            {event.needsVolunteers && (
              <span className="rounded-full border border-blue-600/40 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400">
                Needs volunteers
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      {(event.description || event.occurrenceNote || event.virtualLink) && (
        <CardContent className="flex flex-col gap-3">
          {event.description && (
            <p className="text-sm text-muted-foreground">{event.description}</p>
          )}
          {event.occurrenceNote && (
            <p className="rounded-md border-l-2 border-l-green-600 bg-green-600/10 px-3 py-2 text-sm">
              {event.occurrenceNote}
            </p>
          )}
          {event.virtualLink && (
            <p className="text-sm">
              <strong>Join online:</strong>{" "}
              <a
                href={event.virtualLink}
                target="_blank"
                rel="noreferrer"
                className="text-green-700 underline underline-offset-4 dark:text-green-500"
              >
                {event.virtualLink}
              </a>
              {event.virtualAccessNotes && (
                <span className="block text-muted-foreground">{event.virtualAccessNotes}</span>
              )}
            </p>
          )}
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
