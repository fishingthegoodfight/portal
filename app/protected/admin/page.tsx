import Link from "next/link";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatEventDateRange } from "@/lib/format-date";
import { cn } from "@/lib/utils";

type AdminEventRow = {
  id: number;
  name: string;
  chapter: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  capacity: number | null;
  spots_taken: number | null;
  status: string;
  is_published: boolean | null;
};

/** Filled vs total for one figure; `total` null means no limit. */
type Fill = { filled: number; total: number | null };

/** Only events this close are flagged — further out, low numbers are normal
 * and a flag on everything means nothing. */
const FLAG_WINDOW_DAYS = 21;

/** Under-subscribed participants: under a third of capacity, or — with no
 * limit, so no fraction to judge by — fewer than 3 registered. (Half flagged
 * nearly everything; a flat "fewer than 3" would also flag a healthy small
 * event, e.g. 2 of 5.) */
const participantsLow = (fill: Fill) =>
  fill.total != null ? fill.filled < fill.total / 3 : fill.filled < 3;
/** Any open volunteer slot, since every role is needed to run the event. */
const volunteersLow = (fill: Fill) => fill.total != null && fill.total > 0 && fill.filled < fill.total;

async function AdminEventsLoader() {
  const supabase = await createClient();
  const [{ data: events, error }, { data: roles }] = await Promise.all([
    supabase
      .from("events")
      .select(
        "id, name, chapter, starts_at, ends_at, timezone, capacity, spots_taken, status, is_published",
      )
      .order("starts_at", { ascending: true }),
    supabase
      .from("volunteer_opportunities")
      .select("event_id, slots, slots_taken")
      .is("cancelled_at", null),
  ]);

  if (error) {
    return (
      <p className="text-sm text-red-500">Couldn&apos;t load events: {error.message}</p>
    );
  }

  if (!events || events.length === 0) {
    return <p className="text-sm text-muted-foreground">No events yet.</p>;
  }

  // Volunteer slots filled vs needed, per event (cancelled roles excluded).
  const volunteersByEvent = new Map<number, Fill>();
  for (const role of roles ?? []) {
    const fill = volunteersByEvent.get(role.event_id as number) ?? { filled: 0, total: 0 };
    fill.filled += (role.slots_taken as number) ?? 0;
    fill.total = (fill.total ?? 0) + ((role.slots as number) ?? 0);
    volunteersByEvent.set(role.event_id as number, fill);
  }

  // An event counts as past once it has ended (or, open-ended, started).
  const now = Date.now();
  const isPast = (e: AdminEventRow) => new Date(e.ends_at ?? e.starts_at).getTime() < now;
  const flagUntil = now + FLAG_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const isNear = (e: AdminEventRow) => new Date(e.starts_at).getTime() <= flagUntil;
  const rows = events as AdminEventRow[];
  const upcoming = rows.filter((e) => !isPast(e)); // soonest first (query order)
  const past = rows.filter(isPast).reverse(); // most recent first

  const renderRow = (event: AdminEventRow, isUpcoming: boolean) => (
    <AdminEventListRow
      key={event.id}
      event={event}
      participants={{ filled: event.spots_taken ?? 0, total: event.capacity }}
      volunteers={volunteersByEvent.get(event.id) ?? null}
      flagLow={isUpcoming && isNear(event) && event.status !== "cancelled"}
    />
  );

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Upcoming ({upcoming.length})</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
        ) : (
          <ul className="flex flex-col gap-2">{upcoming.map((e) => renderRow(e, true))}</ul>
        )}
      </section>
      {past.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-muted-foreground">Past ({past.length})</h2>
          <ul className="flex flex-col gap-2 opacity-80">{past.map((e) => renderRow(e, false))}</ul>
        </section>
      )}
    </div>
  );
}

/** One event on the admin list: what, when, and how full — participants and
 * volunteers side by side, with under-subscribed upcoming events flagged. */
function AdminEventListRow({
  event,
  participants,
  volunteers,
  flagLow,
}: {
  event: AdminEventRow;
  participants: Fill;
  /** null when the event has no volunteer roles. */
  volunteers: Fill | null;
  /** Only upcoming, non-cancelled events starting within FLAG_WINDOW_DAYS
   * can be flagged as under-subscribed. */
  flagLow: boolean;
}) {
  const cancelled = event.status === "cancelled";
  const lowParticipants = flagLow && participantsLow(participants);
  const lowVolunteers = flagLow && volunteers != null && volunteersLow(volunteers);
  const needsAttention = lowParticipants || lowVolunteers;

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between",
        needsAttention && "border-l-4 border-l-amber-500",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/protected/admin/events/${event.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {event.name}
          </Link>
          {cancelled && <Badge variant="destructive">Cancelled</Badge>}
          {!event.is_published && <Badge variant="outline">Unpublished</Badge>}
        </div>
        <span className="text-sm text-muted-foreground">
          {formatEventDateRange(event.starts_at, event.ends_at, event.timezone)}
          {event.chapter ? ` · ${event.chapter}` : ""}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <FillFigure label="Participants" fill={participants} low={lowParticipants} />
        {volunteers && <FillFigure label="Volunteers" fill={volunteers} low={lowVolunteers} />}
        <Button asChild variant="outline" size="sm" className="ml-auto sm:ml-0">
          <Link href={`/protected/admin/events/${event.id}`}>Manage</Link>
        </Button>
      </div>
    </li>
  );
}

/** "12 / 20" (or "12 · no limit") under a small label, with a fill bar;
 * amber when under-subscribed. */
function FillFigure({ label, fill, low }: { label: string; fill: Fill; low: boolean }) {
  const pct = fill.total ? Math.min(100, Math.round((fill.filled / fill.total) * 100)) : null;
  return (
    <div className="flex w-24 flex-col gap-1" title={low ? `${label}: under-subscribed` : undefined}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums",
          low && "text-amber-700 dark:text-amber-400",
        )}
      >
        {fill.total == null ? `${fill.filled} · no limit` : `${fill.filled} / ${fill.total}`}
      </span>
      {pct != null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className={cn("h-full rounded-full", low ? "bg-amber-500" : "bg-green-600")}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The header's "Admin" link lands here. Deliberately shows every event —
 * cancelled and past included, not just the published/scheduled/upcoming
 * ones the participant list (app/protected/events) filters to — since this
 * is the only place a "Manage" link to a cancelled event exists, and
 * restoring one requires reaching it first.
 */
export default function AdminEventsIndexPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-2xl mb-1">Manage events</h1>
          <p className="text-sm text-muted-foreground">
            Every event, soonest first, with past ones below. Amber marks an event in the
            next 3 weeks that&apos;s under a third full (fewer than 3 registered with no limit)
            or still has open volunteer slots.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/protected/admin/volunteers">Volunteers</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/protected/admin/waivers">Waivers</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/protected/admin/setup">Setup</Link>
          </Button>
          <Button asChild>
            <Link href="/protected/admin/events/new">New event</Link>
          </Button>
        </div>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <AdminEventsLoader />
      </Suspense>
    </div>
  );
}
