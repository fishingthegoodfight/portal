import Link from "next/link";
import { Suspense } from "react";
import { Megaphone } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { ChapterTag } from "@/components/chapter-tag";
import { ChapterFilterPills, FilterPill, filterHref } from "@/components/filter-pills";
import { CopyEventButton, PostedToggle } from "@/components/admin/marketing-row-controls";
import {
  chapterSelectionLabel,
  chapterSelectionParam,
  isVirtualChapter,
  matchesChapterSelection,
  parseChapterSelection,
  type ChapterSelection,
} from "@/lib/chapters";
import { cityStateZip } from "@/lib/event-location";
import { formatDateInZone, formatEventDateRangeLong } from "@/lib/format-date";
import { combinedDescription } from "@/lib/marketing";

type MarketingEventRow = {
  id: number;
  name: string;
  chapter: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  venue_name: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  location: string | null;
  description: string | null;
  occurrence_note: string | null;
  status: string;
  is_published: boolean | null;
  marketing_tier: number | null;
};

type Post = { event_id: number; posted_by: string | null; posted_at: string };

/** Open vs total volunteer slots; null when the event has no roles. */
type Slots = { open: number; total: number };

type MarketingSearchParams = { chapter?: string; posted?: string };

const BASE_PATH = "/protected/admin/marketing";

/** Full location as lines: venue, street, "City, ST ZIP". Falls back to the
 * free-text location of an event that predates the structured fields. */
function locationLines(e: MarketingEventRow): string[] {
  if (isVirtualChapter(e.chapter)) return ["Online (virtual event)"];
  const lines = [
    e.venue_name?.trim(),
    e.street_address?.trim(),
    cityStateZip(e.city, e.state, e.postal_code),
  ].filter((l): l is string => Boolean(l));
  if (lines.length > 0) return lines;
  return e.location?.trim() ? [e.location.trim()] : [];
}

/** What the copy button puts on the clipboard. */
function plainText(e: MarketingEventRow): string {
  return [
    e.name,
    formatEventDateRangeLong(e.starts_at, e.ends_at, e.timezone),
    locationLines(e).join(", "),
    "",
    combinedDescription(e.description, e.occurrence_note),
  ]
    .join("\n")
    .trim();
}

async function MarketingLoader({ searchParams }: { searchParams: Promise<MarketingSearchParams> }) {
  const { chapter: chapterParam, posted: postedParam } = await searchParams;
  const selection = parseChapterSelection(chapterParam, null);
  const notPostedOnly = postedParam === "no";
  const supabase = await createClient();

  const [{ data: events, error }, { data: roles }, { data: posts }] = await Promise.all([
    supabase
      .from("events")
      .select(
        "id, name, chapter, starts_at, ends_at, timezone, venue_name, street_address, city, state, postal_code, location, description, occurrence_note, status, is_published, marketing_tier",
      )
      .order("starts_at", { ascending: true }),
    supabase
      .from("volunteer_opportunities")
      .select("event_id, slots, slots_taken")
      .is("cancelled_at", null),
    supabase
      .from("event_marketing_posts")
      .select("event_id, posted_by, posted_at")
      .eq("channel", "website"),
  ]);

  if (error) {
    return <p className="text-sm text-red-500">Couldn&apos;t load events: {error.message}</p>;
  }

  const slotsByEvent = new Map<number, Slots>();
  for (const role of roles ?? []) {
    const slots = slotsByEvent.get(role.event_id as number) ?? { open: 0, total: 0 };
    const total = (role.slots as number) ?? 0;
    slots.total += total;
    slots.open += Math.max(total - ((role.slots_taken as number) ?? 0), 0);
    slotsByEvent.set(role.event_id as number, slots);
  }

  const postByEvent = new Map(((posts ?? []) as Post[]).map((p) => [p.event_id, p]));
  const posterIds = [...new Set([...postByEvent.values()].map((p) => p.posted_by).filter(Boolean))] as string[];
  const { data: posters } =
    posterIds.length > 0
      ? await supabase.from("profiles").select("id, first_name, last_name, email").in("id", posterIds)
      : { data: [] };
  const posterName = new Map(
    (posters ?? []).map((p) => [
      p.id as string,
      [p.first_name, p.last_name].filter(Boolean).join(" ") || (p.email as string) || "Someone",
    ]),
  );

  // eslint-disable-next-line react-hooks/purity -- Server Component: renders once per request on the server (after awaiting request data), so there's no re-render or hydration to disagree with this timestamp.
  const now = Date.now();
  const isPast = (e: MarketingEventRow) => new Date(e.ends_at ?? e.starts_at).getTime() < now;
  // The working list: upcoming, still on, and not on the website yet.
  const needsPosting = (e: MarketingEventRow) =>
    !isPast(e) && e.status !== "cancelled" && !postByEvent.has(e.id);

  const rows = ((events ?? []) as MarketingEventRow[]).filter(
    (e) => matchesChapterSelection(selection, e.chapter) && (!notPostedOnly || needsPosting(e)),
  );
  const upcoming = rows.filter((e) => !isPast(e)); // soonest first (query order)
  const past = rows.filter(isPast).reverse(); // most recent first

  const renderRow = (e: MarketingEventRow) => {
    const post = postByEvent.get(e.id);
    const postedLabel = post
      ? `${(post.posted_by && posterName.get(post.posted_by)) || "Someone"} · ${formatDateInZone(post.posted_at, e.timezone)}`
      : null;
    return (
      <MarketingRow
        key={e.id}
        event={e}
        slots={slotsByEvent.get(e.id) ?? null}
        posted={Boolean(post)}
        postedLabel={postedLabel}
      />
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <MarketingFilterBar selection={selection} notPostedOnly={notPostedOnly} />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {notPostedOnly ? "Nothing left to post" : "No events"} for {chapterSelectionLabel(selection)}.
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Upcoming ({upcoming.length})</h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
            ) : (
              <ul className="flex flex-col gap-3">{upcoming.map(renderRow)}</ul>
            )}
          </section>
          {past.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-muted-foreground">Past ({past.length})</h2>
              <ul className="flex flex-col gap-3 opacity-80">{past.map(renderRow)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function MarketingFilterBar({
  selection,
  notPostedOnly,
}: {
  selection: ChapterSelection;
  notPostedOnly: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Chapter</span>
        <ChapterFilterPills
          selection={selection}
          basePath={BASE_PATH}
          otherParams={{ posted: notPostedOnly ? "no" : undefined }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Website</span>
        <div role="group" aria-label="Filter by website status" className="flex flex-wrap gap-2">
          <FilterPill
            href={filterHref(BASE_PATH, { chapter: chapterSelectionParam(selection) })}
            active={!notPostedOnly}
          >
            All events
          </FilterPill>
          <FilterPill
            href={filterHref(BASE_PATH, { chapter: chapterSelectionParam(selection), posted: "no" })}
            active={notPostedOnly}
          >
            Not yet posted to website
          </FilterPill>
        </div>
        {notPostedOnly && (
          <span className="text-xs text-muted-foreground">
            Upcoming events that aren&apos;t cancelled and haven&apos;t been ticked as posted.
          </span>
        )}
      </div>
    </div>
  );
}

function MarketingRow({
  event,
  slots,
  posted,
  postedLabel,
}: {
  event: MarketingEventRow;
  slots: Slots | null;
  posted: boolean;
  postedLabel: string | null;
}) {
  const description = combinedDescription(event.description, event.occurrence_note);
  const location = locationLines(event);
  const boosted = event.marketing_tier === 1;

  return (
    <li className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            {event.chapter && <ChapterTag chapter={event.chapter} />}
            {boosted && (
              <Badge className="gap-1 border-transparent bg-amber-500 text-white hover:bg-amber-500">
                <Megaphone className="size-3" aria-hidden />
                Tier 1
              </Badge>
            )}
            {event.status === "cancelled" && <Badge variant="destructive">Cancelled</Badge>}
            {!event.is_published && <Badge variant="outline">Unpublished</Badge>}
          </div>
          <Link
            href={`/protected/admin/events/${event.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {event.name}
          </Link>
        </div>
        <CopyEventButton text={plainText(event)} />
      </div>

      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">When</dt>
        <dd>{formatEventDateRangeLong(event.starts_at, event.ends_at, event.timezone)}</dd>

        <dt className="text-muted-foreground">Where</dt>
        <dd>
          {location.length > 0 ? (
            location.map((line) => <div key={line}>{line}</div>)
          ) : (
            <span className="text-muted-foreground">No location on file</span>
          )}
        </dd>

        <dt className="text-muted-foreground">Description</dt>
        <dd className="whitespace-pre-line">
          {description || <span className="text-muted-foreground">No description</span>}
        </dd>

        <dt className="text-muted-foreground">Volunteers</dt>
        <dd>
          {!slots || slots.total === 0
            ? "Not needed"
            : slots.open > 0
              ? `Needed — ${slots.open} of ${slots.total} ${slots.total === 1 ? "slot" : "slots"} open`
              : `All ${slots.total} ${slots.total === 1 ? "slot" : "slots"} filled`}
        </dd>

        <dt className="text-muted-foreground">Tier 1 boost</dt>
        <dd>{boosted ? "Yes" : "No"}</dd>
      </dl>

      <div className="border-t pt-3">
        <PostedToggle
          key={String(posted)}
          eventId={event.id}
          channel="website"
          posted={posted}
          postedLabel={postedLabel}
        />
      </div>
    </li>
  );
}

/**
 * Every event in every chapter, for publicising them — upcoming first
 * (soonest first), past below. Admin-only (layout.tsx). "Not yet posted to
 * website" is the working list: upcoming, not cancelled, not ticked yet.
 */
export default function AdminMarketingPage({
  searchParams,
}: {
  searchParams: Promise<MarketingSearchParams>;
}) {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-3xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Marketing</h1>
        <p className="text-sm text-muted-foreground">
          Every event across all chapters. &ldquo;Copy text&rdquo; puts the title, date, time,
          location and description on your clipboard for pasting into the website; tick
          &ldquo;Posted to website&rdquo; once it&apos;s up.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <MarketingLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
