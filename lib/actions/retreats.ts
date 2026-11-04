"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireEventManager } from "@/lib/admin/require-admin";
import { leadAssignmentProblem } from "@/lib/admin/lead-account";
import { loadRegionsAndChapters } from "@/lib/chapters";
import { zonedDateTimeToUtc } from "@/lib/timezone";
import { isWaiverState } from "@/lib/waivers";
import {
  isRetreatAudience,
  parseDollars,
  PRICE_OPTION_COLUMNS,
  retreatEventTypeName,
  type PriceOption,
  type RetreatAudience,
} from "@/lib/retreats";

/**
 * Retreat setup. Creating one, and changing its region or lead, is admins
 * only (events_retreat_guard says so too); everything else is for whoever
 * manages it (can_manage_event: admins and the retreat's lead), with RLS on
 * the retreat tables enforcing the same.
 */

export type RetreatActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** The core fields, as both the create form and the setup page send them. */
export type RetreatCoreInput = {
  name: string;
  regionId: string;
  /** "YYYY-MM-DD" + "HH:MM", in `timezone`. */
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timezone: string;
  description: string;
  /** Raw form text; blank = no limit. */
  capacity: string;
  /** USPS code: whose waiver participants sign. */
  waiverState: string;
  leadName: string;
  leadEmail: string;
  leadPhone: string;
  /** profiles.id, or "". */
  leadUserId: string;
};

type CoreColumns = {
  name: string;
  region_id: number;
  starts_at: string;
  ends_at: string;
  timezone: string;
  description: string | null;
  capacity: number | null;
  waiver_state: string;
  lead_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  lead_user_id: string | null;
};

async function parseCore(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: RetreatCoreInput,
): Promise<{ ok: true; columns: CoreColumns } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name) return fail("Give the retreat a title");
  if (name.length > 200) return fail("The title is too long");

  const regionId = Number(input.regionId);
  const { regions } = await loadRegionsAndChapters(supabase);
  if (!regions.some((r) => r.id === regionId)) return fail("Choose a region");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{2}:\d{2}$/.test(input.startTime)) {
    return fail("Give a start date and time");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.endDate) || !/^\d{2}:\d{2}$/.test(input.endTime)) {
    return fail("Give an end date and time");
  }
  const timezone = input.timezone.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return fail("Choose a time zone");
  }
  const startsAt = zonedDateTimeToUtc(input.startDate, input.startTime, timezone);
  const endsAt = zonedDateTimeToUtc(input.endDate, input.endTime, timezone);
  if (endsAt.getTime() <= startsAt.getTime()) return fail("The retreat has to end after it starts");

  let capacity: number | null = null;
  if (input.capacity.trim()) {
    capacity = Number(input.capacity.trim());
    if (!Number.isInteger(capacity) || capacity < 1) return fail("Capacity is a whole number of at least 1, or blank");
  }

  const waiverState = input.waiverState.trim().toUpperCase();
  if (!isWaiverState(waiverState)) return fail("Choose the state whose waiver participants sign");

  const description = input.description.trim();
  if (description.length > 10000) return fail("The description is too long");

  const leadUserId = input.leadUserId.trim() || null;
  const clash = await leadAssignmentProblem(leadUserId, input.leadEmail);
  if (clash) return fail(clash);

  return {
    ok: true,
    columns: {
      name,
      region_id: regionId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      timezone,
      description: description || null,
      capacity,
      waiver_state: waiverState,
      lead_name: input.leadName.trim() || null,
      lead_email: input.leadEmail.trim() || null,
      lead_phone: input.leadPhone.trim() || null,
      lead_user_id: leadUserId,
    },
  };
}

/** Creates the retreat, unpublished: it goes live from its setup page once
 * the details and prices are in. Admins only. */
export async function createRetreatAction(input: RetreatCoreInput): Promise<RetreatActionResult<{ id: number }>> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if ("error" in gate) return fail(gate.error);

  const core = await parseCore(supabase, input);
  if (!core.ok) return core;

  const eventType = await retreatEventTypeName(supabase);
  const { data, error } = await supabase
    .from("events")
    .insert({
      ...core.columns,
      kind: "retreat",
      chapter: null,
      event_type: eventType,
      spots_taken: 0,
      registration_sections: ["emergency_contact", "fly_fishing_sizing", "waiver"],
      requires_health_history: true,
      is_published: false,
      status: "scheduled",
    })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Couldn't create the retreat");
  return { ok: true, data: { id: data.id as number } };
}

/** Saves the core fields. The region and lead are admins only: the retreat's
 * own lead can save everything else, and those two stay as they were. */
export async function saveRetreatAction(eventId: number, input: RetreatCoreInput): Promise<RetreatActionResult> {
  const supabase = await createClient();
  const gate = await requireEventManager(supabase, eventId);
  if ("error" in gate) return fail(gate.error);

  const core = await parseCore(supabase, input);
  if (!core.ok) return core;

  const update: Partial<CoreColumns> = { ...core.columns };
  if (gate.actor.role !== "admin") {
    delete update.region_id;
    delete update.lead_user_id;
  }
  const { error } = await supabase.from("events").update(update).eq("id", eventId).eq("kind", "retreat");
  if (error) return fail(error.message);
  return { ok: true, data: null };
}

/** Publish or unpublish. */
export async function setRetreatPublishedAction(eventId: number, published: boolean): Promise<RetreatActionResult> {
  const supabase = await createClient();
  const gate = await requireEventManager(supabase, eventId);
  if ("error" in gate) return fail(gate.error);
  const { error } = await supabase
    .from("events")
    .update({ is_published: published })
    .eq("id", eventId)
    .eq("kind", "retreat");
  if (error) return fail(error.message);
  return { ok: true, data: null };
}

export type RetreatDetailsInput = {
  lodgingName: string;
  lodgingAddress: string;
  fishingName: string;
  fishingAddress: string;
  /** Raw text; both or neither. */
  fishingLatitude: string;
  fishingLongitude: string;
  photosUrl: string;
};

function httpsUrl(value: string, what: string): { ok: true; url: string | null } | { ok: false; error: string } {
  const url = value.trim();
  if (!url) return { ok: true, url: null };
  try {
    if (new URL(url).protocol !== "https:") return fail(`${what} has to start with https://`);
  } catch {
    return fail(`${what} isn't a link`);
  }
  return { ok: true, url };
}

export async function saveRetreatDetailsAction(
  eventId: number,
  input: RetreatDetailsInput,
): Promise<RetreatActionResult> {
  const supabase = await createClient();
  const gate = await requireEventManager(supabase, eventId);
  if ("error" in gate) return fail(gate.error);

  const lat = input.fishingLatitude.trim();
  const lng = input.fishingLongitude.trim();
  if (!lat !== !lng) return fail("Give both the latitude and the longitude, or neither");
  const latitude = lat ? Number(lat) : null;
  const longitude = lng ? Number(lng) : null;
  if (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    return fail("Latitude is a number between -90 and 90");
  }
  if (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    return fail("Longitude is a number between -180 and 180");
  }
  const fishingAddress = input.fishingAddress.trim() || null;
  if (fishingAddress && latitude != null) return fail("Give the fishing location an address or coordinates, not both");

  const photos = httpsUrl(input.photosUrl, "The photos link");
  if (!photos.ok) return photos;

  const { error } = await supabase.from("retreat_details").upsert({
    event_id: eventId,
    lodging_name: input.lodgingName.trim() || null,
    lodging_address: input.lodgingAddress.trim() || null,
    fishing_name: input.fishingName.trim() || null,
    fishing_address: fishingAddress,
    fishing_latitude: latitude,
    fishing_longitude: longitude,
    photos_url: photos.url,
    updated_by: gate.actor.userId,
    updated_at: new Date().toISOString(),
  });
  if (error) return fail(error.message);
  return { ok: true, data: null };
}

export type RetreatSessionInput = {
  /** retreat_sessions.id, or null for a new one. */
  id: number | null;
  title: string;
  /** "YYYY-MM-DD" + "HH:MM", in the retreat's time zone. */
  date: string;
  startTime: string;
  /** "HH:MM" or "": same day. */
  endTime: string;
  meetingUrl: string;
  audience: RetreatAudience | "";
};

export async function saveRetreatSessionAction(
  eventId: number,
  input: RetreatSessionInput,
): Promise<RetreatActionResult> {
  const supabase = await createClient();
  const gate = await requireEventManager(supabase, eventId);
  if ("error" in gate) return fail(gate.error);

  const title = input.title.trim();
  if (!title) return fail("Give the session a title");
  if (!isRetreatAudience(input.audience)) return fail("Choose who the session is for");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.startTime)) {
    return fail("Give the session a date and start time");
  }
  if (input.endTime && !/^\d{2}:\d{2}$/.test(input.endTime)) return fail("The end time isn't a time");
  const meeting = httpsUrl(input.meetingUrl, "The meeting link");
  if (!meeting.ok) return meeting;

  const { data: retreat } = await supabase
    .from("events")
    .select("timezone")
    .eq("id", eventId)
    .eq("kind", "retreat")
    .maybeSingle();
  if (!retreat) return fail("Retreat not found");
  const timezone = retreat.timezone as string;
  const startsAt = zonedDateTimeToUtc(input.date, input.startTime, timezone);
  const endsAt = input.endTime ? zonedDateTimeToUtc(input.date, input.endTime, timezone) : null;
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) return fail("The session has to end after it starts");

  const row = {
    title,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt?.toISOString() ?? null,
    meeting_url: meeting.url,
    audience: input.audience,
    updated_at: new Date().toISOString(),
  };
  const { error } = input.id
    ? await supabase.from("retreat_sessions").update(row).eq("id", input.id).eq("event_id", eventId)
    : await supabase.from("retreat_sessions").insert({ ...row, event_id: eventId });
  if (error) return fail(error.message);
  return { ok: true, data: null };
}

export async function deleteRetreatSessionAction(eventId: number, sessionId: number): Promise<RetreatActionResult> {
  const supabase = await createClient();
  const gate = await requireEventManager(supabase, eventId);
  if ("error" in gate) return fail(gate.error);
  const { error } = await supabase.from("retreat_sessions").delete().eq("id", sessionId).eq("event_id", eventId);
  if (error) return fail(error.message);
  return { ok: true, data: null };
}

export type PriceOptionInput = {
  /** retreat_price_options.id, or null for a new one. */
  id: number | null;
  label: string;
  /** Raw form text, in dollars. */
  amount: string;
  description: string;
  isTrueCost: boolean;
};

/** Saves the whole list as shown: rows kept are updated (in this order),
 * new ones added, missing ones removed. */
export async function savePriceOptionsAction(
  eventId: number,
  options: PriceOptionInput[],
): Promise<RetreatActionResult> {
  const supabase = await createClient();
  const gate = await requireEventManager(supabase, eventId);
  if ("error" in gate) return fail(gate.error);

  if (options.length > 20) return fail("That's more price options than a retreat can have (20)");
  if (options.filter((o) => o.isTrueCost).length > 1) return fail("Only one option can be the true cost");
  const parsed: { id: number | null; label: string; amount_cents: number; description: string | null; is_true_cost: boolean; sort_order: number }[] = [];
  for (const [index, option] of options.entries()) {
    const label = option.label.trim();
    if (!label) return fail(`Option ${index + 1} needs a label`);
    if (label.length > 100) return fail(`"${label.slice(0, 30)}…" is too long a label`);
    const amount = parseDollars(option.amount);
    if (amount == null) return fail(`"${label}" needs an amount in dollars (0 is fine)`);
    const description = option.description.trim();
    if (description.length > 500) return fail(`"${label}"'s description is too long`);
    parsed.push({
      id: option.id,
      label,
      amount_cents: amount,
      description: description || null,
      is_true_cost: option.isTrueCost,
      sort_order: (index + 1) * 10,
    });
  }

  const { data: existing, error: loadError } = await supabase
    .from("retreat_price_options")
    .select("id")
    .eq("event_id", eventId);
  if (loadError) return fail(loadError.message);
  const keep = new Set(parsed.map((o) => o.id).filter((id): id is number => id != null));
  const removed = ((existing ?? []) as { id: number }[]).map((r) => r.id).filter((id) => !keep.has(id));

  // Clear the true-cost mark first, so moving it between rows never trips
  // the one-per-retreat index halfway through.
  const { error: clearError } = await supabase
    .from("retreat_price_options")
    .update({ is_true_cost: false })
    .eq("event_id", eventId)
    .eq("is_true_cost", true);
  if (clearError) return fail(clearError.message);

  if (removed.length > 0) {
    const { error } = await supabase.from("retreat_price_options").delete().eq("event_id", eventId).in("id", removed);
    if (error) return fail(error.message);
  }
  const now = new Date().toISOString();
  for (const option of parsed) {
    const { id, ...row } = option;
    const { error } = id
      ? await supabase
          .from("retreat_price_options")
          .update({ ...row, updated_at: now })
          .eq("id", id)
          .eq("event_id", eventId)
      : await supabase.from("retreat_price_options").insert({ ...row, event_id: eventId });
    if (error) return fail(error.message);
  }
  return { ok: true, data: null };
}

/** Another retreat's price options, to start this one's list from. The
 * caller saves them (as new rows) with savePriceOptionsAction. */
export async function priceOptionsFromRetreatAction(
  eventId: number,
  fromEventId: number,
): Promise<RetreatActionResult<PriceOption[]>> {
  const supabase = await createClient();
  const gate = await requireEventManager(supabase, eventId);
  if ("error" in gate) return fail(gate.error);
  const { data, error } = await supabase
    .from("retreat_price_options")
    .select(PRICE_OPTION_COLUMNS)
    .eq("event_id", fromEventId)
    .order("sort_order", { ascending: true });
  if (error) return fail(error.message);
  return { ok: true, data: (data ?? []) as PriceOption[] };
}

export type RetreatPaymentSettingsInput = {
  /** Raw dollars; blank = no deposit option. */
  deposit: string;
  /** "YYYY-MM-DD", or "" for the default (60 days before the start). */
  balanceDueDate: string;
  refundPolicy: string;
};

export async function saveRetreatPaymentSettingsAction(
  eventId: number,
  input: RetreatPaymentSettingsInput,
): Promise<RetreatActionResult> {
  const supabase = await createClient();
  const gate = await requireEventManager(supabase, eventId);
  if ("error" in gate) return fail(gate.error);

  let deposit: number | null = null;
  if (input.deposit.trim()) {
    deposit = parseDollars(input.deposit);
    if (deposit == null) return fail("The deposit is an amount in dollars, or blank");
  }
  const due = input.balanceDueDate.trim();
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return fail("The balance due date isn't a date");
  const refundPolicy = input.refundPolicy.trim();
  if (refundPolicy.length > 5000) return fail("The refund policy is too long");

  const { data: retreat } = await supabase
    .from("events")
    .select("starts_at, timezone")
    .eq("id", eventId)
    .eq("kind", "retreat")
    .maybeSingle();
  if (!retreat) return fail("Retreat not found");
  const startDate = new Intl.DateTimeFormat("en-CA", { timeZone: retreat.timezone as string }).format(
    new Date(retreat.starts_at as string),
  );
  if (due && due >= startDate) return fail("The balance has to be due before the retreat starts");

  const { error } = await supabase
    .from("events")
    .update({ deposit_cents: deposit, balance_due_date: due || null, refund_policy: refundPolicy || null })
    .eq("id", eventId)
    .eq("kind", "retreat");
  if (error) return fail(error.message);
  return { ok: true, data: null };
}
