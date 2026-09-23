import { cache } from "react";

import { createAnonClient } from "@/lib/supabase/anon";
import { isVirtualChapter } from "@/lib/chapters";

/**
 * Exactly the columns granted to anon on events (see the 2026-09-23 "Public
 * event pages" schema-changes.sql entry). Asking for anything else — the
 * meeting link above all — fails with "permission denied" rather than
 * leaking, so this list can only ever be a subset of that grant.
 */
const PUBLIC_EVENT_COLUMNS =
  "id, slug, name, chapter, event_type, starts_at, ends_at, timezone, location, venue_name, street_address, city, state, description, occurrence_note, capacity, spots_taken, status, cancellation_reason";

export type PublicEvent = {
  id: number;
  slug: string;
  name: string;
  chapter: string | null;
  event_type: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  location: string | null;
  venue_name: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  description: string | null;
  occurrence_note: string | null;
  capacity: number | null;
  spots_taken: number | null;
  status: string;
  cancellation_reason: string | null;
};

export type PublicEventLookup =
  | { kind: "found"; event: PublicEvent; spotsLeft: number | null }
  /** An old numeric-id URL or a retired slug — send them to the current one. */
  | { kind: "redirect"; slug: string }
  | { kind: "not_found" };

/**
 * The event behind a public URL segment: its current slug, an old numeric id
 * (/events/123), or a slug it used before an admin changed it. Unpublished
 * events aren't visible to anon at all, so they come back not_found.
 * Memoized per request, so generateMetadata and the page share one lookup.
 */
export const loadPublicEvent = cache(async (param: string): Promise<PublicEventLookup> => {
  const supabase = createAnonClient();
  let key: string;
  try {
    key = decodeURIComponent(param).trim().toLowerCase();
  } catch {
    return { kind: "not_found" }; // malformed %-escape
  }

  if (/^\d+$/.test(key)) {
    const { data } = await supabase.from("events").select("slug").eq("id", Number(key)).maybeSingle();
    return data ? { kind: "redirect", slug: data.slug as string } : { kind: "not_found" };
  }

  const { data: event } = await supabase
    .from("events")
    .select(PUBLIC_EVENT_COLUMNS)
    .eq("slug", key)
    .maybeSingle();

  if (!event) {
    const { data: alias } = await supabase
      .from("event_slug_aliases")
      .select("event_id")
      .eq("slug", key)
      .maybeSingle();
    if (!alias) return { kind: "not_found" };
    const { data: current } = await supabase
      .from("events")
      .select("slug")
      .eq("id", alias.event_id as number)
      .maybeSingle();
    return current ? { kind: "redirect", slug: current.slug as string } : { kind: "not_found" };
  }

  // Open waitlist offers hold a spot, same as on the signed-in pages.
  let spotsLeft: number | null = null;
  if (event.capacity != null) {
    const { data: offered } = await supabase.rpc("event_offered_counts", {
      p_event_ids: [event.id],
    });
    const offeredCount =
      ((offered ?? []) as { event_id: number; offered_count: number }[])[0]?.offered_count ?? 0;
    spotsLeft = Math.max((event.capacity as number) - ((event.spots_taken as number | null) ?? 0) - offeredCount, 0);
  }

  return { kind: "found", event: event as PublicEvent, spotsLeft };
});

/** The address as shown publicly: venue, street, "City, ST" on separate
 * lines, or the older free-text location; nothing for a virtual event. */
export function publicLocationLines(event: PublicEvent): string[] {
  if (isVirtualChapter(event.chapter)) return [];
  const cityState = [event.city, event.state].filter(Boolean).join(", ");
  const lines = [event.venue_name, event.street_address, cityState].filter(
    (line): line is string => Boolean(line?.trim()),
  );
  if (lines.length > 0) return lines;
  return event.location ? [event.location] : [];
}

/** One line for link previews and the share image: "Venue, City, ST", or
 * "Online" for a virtual event. */
export function publicLocationSummary(event: PublicEvent): string | null {
  if (isVirtualChapter(event.chapter)) return "Online";
  const cityState = [event.city, event.state].filter(Boolean).join(", ");
  const parts = [event.venue_name, cityState].filter((p): p is string => Boolean(p?.trim()));
  return parts.length > 0 ? parts.join(", ") : event.location;
}

/** Whether the event is over: its end (or, open-ended, its start) has passed. */
export function hasHappened(event: PublicEvent, now: Date): boolean {
  return new Date(event.ends_at ?? event.starts_at).getTime() < now.getTime();
}
