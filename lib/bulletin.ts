import QRCode from "qrcode";

import { createAdminClient } from "@/lib/supabase/admin";
import { isVirtualChapter, loadRegionsAndChapters } from "@/lib/chapters";
import { spotsLeft } from "@/lib/event-capacity";
import { publicEventPath } from "@/lib/event-slug";
import { formatEventDateRange } from "@/lib/format-date";
import { dateInZone, SCHEDULE_ZONE } from "@/lib/opportunities-schedule";
import { loadUpcomingPublicEvents, publicLocationSummary, type PublicEvent } from "@/lib/public-events";
import { getSiteUrl } from "@/lib/site-url";

/**
 * The weekly bulletin (app/bulletin): a printable page chapter leads bring
 * to their events to announce what else is going on — retreats with their
 * enrollment, the next two weeks' events by region with the ones that need
 * volunteers, and QR codes to the public events list and the public
 * volunteer page. Emailed to the admins every Monday (the admin-digest
 * cron), and public like the events list, so a lead can print it without
 * signing in.
 *
 * Events come through the anon client (loadUpcomingPublicEvents), so only
 * published events can appear. Region names and open volunteer slots aren't
 * readable by anon, so they're read with the service role — narrowly: the
 * region of each chapter, and the role names and open-slot counts of the
 * events already on the page, nothing else.
 */

/** How far ahead the events section looks. */
export const BULLETIN_DAYS = 14;
/** How far ahead the public volunteer page lists events needing help. */
export const VOLUNTEER_PAGE_DAYS = 42;

/** A role still short of volunteers; same-named roles at one event are
 * added together. */
export type VolunteerNeed = { role: string; open: number };

export type BulletinEvent = {
  id: number;
  name: string;
  /** Path of the public event page. */
  path: string;
  chapter: string | null;
  /** "Sat, Oct 17" in the event's timezone. */
  day: string;
  /** The same date in parts, for a calendar-style block: "Sat", "Oct", "17". */
  dateParts: { weekday: string; month: string; day: string };
  /** The rest of the range: "9:00 AM – 1:00 PM MDT". */
  time: string;
  where: string | null;
  /** Null when the event has no limit. */
  spotsLeft: number | null;
  needs: VolunteerNeed[];
  startsAt: string;
};

export type BulletinRegion = { name: string; events: BulletinEvent[] };

/** A retreat open for enrollment. Retreats aren't in the portal yet, so
 * loadOpenRetreats returns none; the section is laid out ready for them. */
export type BulletinRetreat = {
  name: string;
  dates: string;
  where: string | null;
  enrolled: number;
  capacity: number | null;
  path: string;
};

export type Bulletin = {
  /** "Oct 12 – Oct 25" (Denver dates). */
  rangeLabel: string;
  /** "Mon, Oct 12, 2026": when this was put together. */
  generatedLabel: string;
  retreats: BulletinRetreat[];
  /** In Setup's region order; online, then anything without a region,
   * last. Regions with no events in the window are left out. */
  regions: BulletinRegion[];
  /** Every region with a chapter, for the page's filter (whether or not
   * it has events this time). */
  regionNames: string[];
  eventCount: number;
  needingVolunteers: number;
  openVolunteerSlots: number;
};

const ONLINE = "Online";
const OTHER = "Other";

/** Retreats open for enrollment, soonest first. None until retreats are
 * built into the portal: return them here then, and they show on the
 * bulletin and in the Monday email with no other change. */
export async function loadOpenRetreats(): Promise<BulletinRetreat[]> {
  return [];
}

/** Open volunteer roles at these events (not cancelled, not yet full), by
 * event id. */
async function loadVolunteerNeeds(
  admin: ReturnType<typeof createAdminClient>,
  eventIds: number[],
): Promise<Map<number, VolunteerNeed[]>> {
  const byEvent = new Map<number, VolunteerNeed[]>();
  if (eventIds.length === 0) return byEvent;
  const { data, error } = await admin
    .from("volunteer_opportunities")
    .select("event_id, role, slots, slots_taken")
    .in("event_id", eventIds)
    .is("cancelled_at", null);
  if (error) throw new Error(`volunteer_opportunities: ${error.message}`);
  for (const row of (data ?? []) as { event_id: number; role: string; slots: number; slots_taken: number }[]) {
    const open = row.slots - row.slots_taken;
    if (open <= 0) continue;
    const needs = byEvent.get(row.event_id) ?? [];
    const same = needs.find((n) => n.role === row.role);
    if (same) same.open += open;
    else needs.push({ role: row.role, open });
    byEvent.set(row.event_id, needs);
  }
  return byEvent;
}

function toBulletinEvent(event: PublicEvent, needs: VolunteerNeed[]): BulletinEvent {
  const range = formatEventDateRange(event.starts_at, event.ends_at, event.timezone);
  const [day, ...rest] = range.split(" · ");
  return {
    id: event.id,
    name: event.name,
    path: publicEventPath(event.slug),
    chapter: event.chapter,
    day,
    dateParts: Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: event.timezone })
        .formatToParts(new Date(event.starts_at))
        .filter((p) => p.type === "weekday" || p.type === "month" || p.type === "day")
        .map((p) => [p.type, p.value]),
    ) as BulletinEvent["dateParts"],
    time: rest.join(" · "),
    where: publicLocationSummary(event),
    spotsLeft: event.capacity == null ? null : Math.max(spotsLeft(event.capacity, event.spots_taken) ?? 0, 0),
    needs,
    startsAt: event.starts_at,
  };
}

const shortDate = (date: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );

/** Published, scheduled events starting within `days` of now, with their
 * open volunteer roles, grouped by region. */
async function loadEventsByRegion(now: Date, days: number) {
  const admin = createAdminClient();
  const until = now.getTime() + days * 86_400_000;
  const events = (await loadUpcomingPublicEvents(now)).filter((e) => new Date(e.starts_at).getTime() < until);
  const [{ regions, chapters }, needs] = await Promise.all([
    loadRegionsAndChapters(admin),
    loadVolunteerNeeds(
      admin,
      events.map((e) => e.id),
    ),
  ]);
  const regionById = new Map(regions.map((r) => [r.id, r.name]));
  const regionOfChapter = new Map(chapters.map((c) => [c.name, regionById.get(c.region_id) ?? OTHER]));
  const regionOf = (chapter: string | null) =>
    isVirtualChapter(chapter) ? ONLINE : ((chapter && regionOfChapter.get(chapter)) ?? OTHER);

  const order = [...regions.map((r) => r.name), ONLINE, OTHER];
  const grouped = new Map<string, BulletinEvent[]>();
  for (const event of events) {
    const region = regionOf(event.chapter);
    grouped.set(region, [...(grouped.get(region) ?? []), toBulletinEvent(event, needs.get(event.id) ?? [])]);
  }
  const regionNames = regions
    .filter((r) => r.active && chapters.some((c) => c.active && c.region_id === r.id))
    .map((r) => r.name);
  return {
    regions: order.filter((name) => grouped.has(name)).map((name) => ({ name, events: grouped.get(name)! })),
    regionNames,
  };
}

/** Everything on the bulletin. `region` narrows the events to one region
 * (case-insensitive; unknown names show nothing) plus the online events,
 * for a lead printing just their own. */
export async function loadBulletin(now: Date, region?: string | null): Promise<Bulletin> {
  const [{ regions: allRegions, regionNames }, retreats] = await Promise.all([
    loadEventsByRegion(now, BULLETIN_DAYS),
    loadOpenRetreats(),
  ]);
  // A region's bulletin keeps the online events: anyone can join those.
  const regions = region
    ? allRegions.filter((r) => r.name === ONLINE || r.name.toLowerCase() === region.toLowerCase())
    : allRegions;
  const events = regions.flatMap((r) => r.events);
  const today = dateInZone(now, SCHEDULE_ZONE);
  const last = dateInZone(new Date(now.getTime() + (BULLETIN_DAYS - 1) * 86_400_000), SCHEDULE_ZONE);
  return {
    rangeLabel: `${shortDate(today)} – ${shortDate(last)}`,
    generatedLabel: new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: SCHEDULE_ZONE,
    }).format(now),
    retreats,
    regions,
    regionNames,
    eventCount: events.length,
    needingVolunteers: events.filter((e) => e.needs.length > 0).length,
    openVolunteerSlots: events.reduce((n, e) => n + e.needs.reduce((m, need) => m + need.open, 0), 0),
  };
}

/** Upcoming events that still need volunteers, soonest first — the public
 * volunteer page's list. */
export async function loadEventsNeedingVolunteers(now: Date): Promise<BulletinEvent[]> {
  const { regions } = await loadEventsByRegion(now, VOLUNTEER_PAGE_DAYS);
  return regions
    .flatMap((r) => r.events)
    .filter((e) => e.needs.length > 0)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** The two QR codes' destinations: the public events list and the public
 * volunteer page. */
export function bulletinLinks() {
  const site = getSiteUrl();
  return { events: `${site}/events`, volunteer: `${site}/volunteer` };
}

/** A QR code as inline SVG markup. "M" error correction survives a crease
 * or smudge on a printed page. */
export async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1c1917", light: "#ffffff" } });
}

/** "5 spots left", "Full", or null (no limit). */
export function spotsLabel(spots: number | null): string | null {
  if (spots == null) return null;
  return spots === 0 ? "Full" : `${spots} ${spots === 1 ? "spot" : "spots"} left`;
}

/** "Boat captain (2), Fly-tying helper" */
export function needsLabel(needs: VolunteerNeed[]): string {
  return needs.map((n) => (n.open > 1 ? `${n.role} (${n.open})` : n.role)).join(", ");
}
