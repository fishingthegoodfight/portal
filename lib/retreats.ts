import type { SupabaseClient } from "@supabase/supabase-js";

import type { Chapter, Region } from "@/lib/chapters";
import { addDays, dateInZone } from "@/lib/format-date";

/**
 * Retreats: events with kind = 'retreat', tied to a region rather than a
 * chapter (see the 2026-11-04 "Retreats, part 1" entry in
 * schema-changes.sql). Who manages one is the ordinary can_manage_event
 * rule, which for a retreat (no chapter) means admins and its own lead.
 *
 * The private details live in their own tables, readable only by the
 * people the database lets through (retreat_viewer_audiences): lodging,
 * fishing location and the photos link in retreat_details; virtual
 * sessions, each for one audience, in retreat_sessions. Read them with the
 * signed-in client and RLS decides; never with the service role.
 */

export const RETREAT_AUDIENCES = ["participants", "volunteers", "leadership"] as const;
export type RetreatAudience = (typeof RETREAT_AUDIENCES)[number];

export const AUDIENCE_LABELS: Record<RetreatAudience, string> = {
  participants: "Participants",
  volunteers: "Volunteers",
  leadership: "Leadership team",
};

export const isRetreatAudience = (v: unknown): v is RetreatAudience =>
  typeof v === "string" && (RETREAT_AUDIENCES as readonly string[]).includes(v);

/** The default balance due date: 60 days before the start. */
export const BALANCE_DUE_DAYS_BEFORE = 60;

export type RetreatDetails = {
  lodging_name: string | null;
  lodging_address: string | null;
  fishing_name: string | null;
  fishing_address: string | null;
  fishing_latitude: number | null;
  fishing_longitude: number | null;
  photos_url: string | null;
};

export const RETREAT_DETAILS_COLUMNS =
  "lodging_name, lodging_address, fishing_name, fishing_address, fishing_latitude, fishing_longitude, photos_url";

export type RetreatSession = {
  id: number;
  title: string;
  starts_at: string;
  ends_at: string | null;
  meeting_url: string | null;
  audience: RetreatAudience;
};

export const RETREAT_SESSION_COLUMNS = "id, title, starts_at, ends_at, meeting_url, audience";

export type PriceOption = {
  id: number;
  label: string;
  amount_cents: number;
  description: string | null;
  is_true_cost: boolean;
  sort_order: number;
};

/** Exactly the columns granted to anon on retreat_price_options. */
export const PRICE_OPTION_COLUMNS = "id, label, amount_cents, description, is_true_cost, sort_order";

/** Price options in display order. Works for anon (published retreats) and
 * signed-in people alike. */
export async function loadPriceOptions(supabase: SupabaseClient, eventId: number): Promise<PriceOption[]> {
  const { data } = await supabase
    .from("retreat_price_options")
    .select(PRICE_OPTION_COLUMNS)
    .eq("event_id", eventId)
    .order("sort_order", { ascending: true })
    .order("amount_cents", { ascending: true });
  return ((data ?? []) as PriceOption[]).map((o) => ({ ...o, amount_cents: Number(o.amount_cents) }));
}

/** The event_types row retreats use, by its name (events.event_type stores
 * the name): key 'retreat', or one already named "Retreat". */
export async function retreatEventTypeName(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.from("event_types").select("key, name").or("key.eq.retreat,name.ilike.retreat");
  const rows = (data ?? []) as { key: string; name: string }[];
  return (rows.find((r) => r.key === "retreat") ?? rows[0])?.name ?? "Retreat";
}

/** The chapters in a retreat's region: a retreat shows under each of them
 * in the chapter filters. */
export function regionChapterNames(regionId: number | null | undefined, chapters: Chapter[]): string[] {
  if (regionId == null) return [];
  return chapters.filter((c) => c.region_id === regionId).map((c) => c.name);
}

export function regionName(regionId: number | null | undefined, regions: Region[]): string | null {
  if (regionId == null) return null;
  return regions.find((r) => r.id === regionId)?.name ?? null;
}

/** The events.chapter-like values an event matches in a chapter filter:
 * its chapter, or for a retreat every chapter in its region. */
export function eventFilterChapters(
  event: { chapter: string | null; kind?: string | null; region_id?: number | null },
  chapters: Chapter[],
): string[] {
  if (event.kind === "retreat") return regionChapterNames(event.region_id, chapters);
  return event.chapter ? [event.chapter] : [];
}

/** When the balance is due: the retreat's own date, else 60 days before it
 * starts (in its time zone). Same rule as retreat_balance_due_date(). */
export function balanceDueDate(retreat: { balance_due_date: string | null; starts_at: string; timezone: string }): string {
  return (
    retreat.balance_due_date ?? addDays(dateInZone(new Date(retreat.starts_at), retreat.timezone), -BALANCE_DUE_DAYS_BEFORE)
  );
}

/** A Google Maps link for the fishing location: the coordinates if set,
 * else the address. Null when there's neither. */
export function fishingMapUrl(details: RetreatDetails): string | null {
  if (details.fishing_latitude != null && details.fishing_longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${details.fishing_latitude},${details.fishing_longitude}`;
  }
  if (details.fishing_address?.trim()) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(details.fishing_address.trim())}`;
  }
  return null;
}

/** Same, for the lodging address. */
export function lodgingMapUrl(details: RetreatDetails): string | null {
  return details.lodging_address?.trim()
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(details.lodging_address.trim())}`
    : null;
}

/** The audiences the signed-in caller belongs to at a retreat
 * (retreat_viewer_audiences): what they're shown, and as whom. */
export async function loadViewerAudiences(supabase: SupabaseClient, eventId: number): Promise<RetreatAudience[]> {
  const { data } = await supabase.rpc("retreat_viewer_audiences", { p_event_id: eventId });
  return ((data as string[] | null) ?? []).filter(isRetreatAudience);
}

/** "$1,500" or "$62.50". */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString("en-US")}`
    : `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "1500" / "$1,500.00" → 150000; null when it isn't a non-negative amount. */
export function parseDollars(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Cents as an input's value: "1500", "62.50", "" for null. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

/** The retreat row as the setup page and the signed-in page read it. */
export type RetreatRow = {
  id: number;
  slug: string;
  name: string;
  kind: string;
  region_id: number;
  event_type: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  description: string | null;
  capacity: number | null;
  spots_taken: number | null;
  status: string;
  is_published: boolean;
  lead_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  lead_user_id: string | null;
  waiver_state: string | null;
  deposit_cents: number | null;
  balance_due_date: string | null;
  refund_policy: string | null;
};

export const RETREAT_COLUMNS =
  "id, slug, name, kind, region_id, event_type, starts_at, ends_at, timezone, description, capacity, spots_taken, status, is_published, lead_name, lead_email, lead_phone, lead_user_id, waiver_state, deposit_cents, balance_due_date, refund_policy";
