"use server";

import { createClient } from "@/lib/supabase/server";
import { actorLabel, loadManagedEventIds, requireEventManager } from "@/lib/admin/require-admin";
import { formatEventDateRange } from "@/lib/format-date";
import { normalizeSlug, publicEventPath, slugError } from "@/lib/event-slug";
import { toZonedDateTimeInputs, zonedDateTimeToUtc } from "@/lib/timezone";
import {
  cancelEventVolunteerSignups,
  countSignupsCancelledWithEvent,
  emailVolunteersEventRestored,
  executeRoleOps,
  loadActiveRoles,
  planEventRoles,
  planSiblingRoles,
  type EditableVolunteerRole,
  type ExistingRole,
  type RoleOp,
  type RolePlan,
} from "@/lib/admin/event-roles";
import { laterOccurrenceIds, peopleByEvent, sumPeople, type EditScope } from "@/lib/admin/series";
import {
  isSectionComplete,
  profileValueFromColumn,
  REGISTRATION_SECTIONS,
} from "@/lib/registration-sections";
import {
  previewEventCancellationEmail,
  sendAdminChangeNotificationEmail,
  sendEventCancellationEmail,
  sendEventRestoredEmail,
  sendEventUpdateEmail,
  type RsvpEmailEvent,
} from "@/lib/email/send";
import type { EventChangeDiffEntry } from "@/lib/email/templates";
import { expireExcessOffers, offerFreeSpots } from "@/lib/waitlist";
import { capacityError, parseCapacity } from "@/lib/event-capacity";
import { composeLocation, isLocationEmpty, locationErrors } from "@/lib/event-location";
import { CHAPTERS, isVirtualChapter } from "@/lib/chapters";
import { friendlyEventDbError, type EventFormField } from "@/lib/event-db-errors";
import {
  isWaiverState,
  resolveEventWaiver,
  waiverStateForChapter,
  WAIVER_STATES,
} from "@/lib/waivers";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EventRow = {
  id: number;
  name: string;
  event_type: string | null;
  description: string | null;
  occurrence_note: string | null;
  location: string | null;
  venue_name: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  virtual_link: string | null;
  virtual_access_notes: string | null;
  capacity: number | null;
  lead_name: string | null;
  /** The lead's account, if they have one — gives them manage rights on
   * this event (can_manage_event). */
  lead_user_id: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  custom_email_note: string | null;
  registration_sections: string[] | null;
  chapter: string | null;
  waiver_state: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  ics_sequence: number;
  status: string;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  series_id: string | null;
  /** The public URL's /events/<slug> — see lib/event-slug.ts. */
  slug: string;
  /** 1 (most marketing) – 3 (least), or null. Only ever this occurrence's
   * own — never carried across a series. */
  marketing_tier: number | null;
  /** Everyone at the event needs a current health form. */
  requires_health_history: boolean;
};

const EVENT_COLUMNS =
  "id, slug, name, event_type, description, occurrence_note, location, venue_name, street_address, city, state, postal_code, virtual_link, virtual_access_notes, capacity, lead_name, lead_user_id, lead_phone, lead_email, custom_email_note, registration_sections, chapter, waiver_state, starts_at, ends_at, timezone, ics_sequence, status, cancellation_reason, cancelled_at, series_id, marketing_tier, requires_health_history";

async function loadEvent(
  supabase: SupabaseServerClient,
  eventId: number,
): Promise<EventRow | null> {
  const { data } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("id", eventId)
    .maybeSingle();
  return (data as EventRow | null) ?? null;
}

/** For an "all future events" edit or cancel: the scheduled occurrences after
 * this one in its series (lib/admin/series.ts), soonest first. */
async function loadLaterOccurrences(
  supabase: SupabaseServerClient,
  event: EventRow,
): Promise<EventRow[]> {
  if (!event.series_id) return [];
  // Only occurrences the caller also manages (can_manage_event) — a series
  // normally shares its chapter and lead, but one occurrence may since have
  // been moved or re-led.
  const managed = await loadManagedEventIds(supabase);
  const ids = (await laterOccurrenceIds(supabase, event.series_id, event.starts_at)).filter((id) =>
    managed.has(id),
  );
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .in("id", ids)
    .order("starts_at", { ascending: true });
  return (data ?? []) as EventRow[];
}

async function confirmedRsvpEmails(
  supabase: SupabaseServerClient,
  eventId: number,
): Promise<string[]> {
  const { data: rsvps } = await supabase
    .from("rsvps")
    .select("user_id")
    .eq("event_id", eventId)
    .eq("status", "confirmed");
  const userIds = (rsvps ?? []).map((r) => r.user_id as string);
  if (userIds.length === 0) return [];

  const { data: profiles } = await supabase.from("profiles").select("email").in("id", userIds);
  return (profiles ?? [])
    .map((p) => p.email as string | null)
    .filter((email): email is string => Boolean(email));
}

async function countSignatures(
  supabase: SupabaseServerClient,
  waiverId: number | null,
  userIds: string[],
): Promise<number> {
  if (waiverId == null || userIds.length === 0) return 0;
  const { count } = await supabase
    .from("waiver_signatures")
    .select("*", { count: "exact", head: true })
    .eq("waiver_id", waiverId)
    .in("user_id", userIds);
  return count ?? 0;
}

/** Who is affected when the event's waiver state changes, or null when
 * nobody is registered. Read before anything is written. */
async function waiverChangeImpact(
  supabase: SupabaseServerClient,
  before: EventRow,
  after: EventRow,
): Promise<WaiverChangeImpact | null> {
  const { data: rsvps } = await supabase
    .from("rsvps")
    .select("user_id")
    .eq("event_id", before.id)
    .in("status", ["confirmed", "waitlisted", "offered"]);
  const userIds = (rsvps ?? []).map((r) => r.user_id as string);
  if (userIds.length === 0) return null;

  const oldRequirement = await resolveEventWaiver(supabase, before);
  const newRequirement = await resolveEventWaiver(supabase, after);
  const oldState = waiverStateForChapter(before.chapter) ?? before.waiver_state;
  const newState = after.waiver_state;

  return {
    oldStateName: isWaiverState(oldState) ? WAIVER_STATES[oldState] : "previous",
    newStateName: isWaiverState(newState) ? WAIVER_STATES[newState] : "new",
    registeredCount: userIds.length,
    signedOldCount: await countSignatures(
      supabase,
      oldRequirement.kind === "ok" ? oldRequirement.waiver.id : null,
      userIds,
    ),
    alreadySignedNewCount: await countSignatures(
      supabase,
      newRequirement.kind === "ok" ? newRequirement.waiver.id : null,
      userIds,
    ),
    newWaiverMissing: newRequirement.kind !== "ok",
  };
}

async function confirmedAttendees(
  supabase: SupabaseServerClient,
  eventId: number,
): Promise<{ userId: string; email: string }[]> {
  const { data: rsvps } = await supabase
    .from("rsvps")
    .select("user_id")
    .eq("event_id", eventId)
    .eq("status", "confirmed");
  const userIds = (rsvps ?? []).map((r) => r.user_id as string);
  if (userIds.length === 0) return [];

  const { data: profiles } = await supabase.from("profiles").select("id, email").in("id", userIds);
  return (profiles ?? [])
    .filter((p) => Boolean(p.email))
    .map((p) => ({ userId: p.id as string, email: p.email as string }));
}

async function countConfirmedRsvps(
  supabase: SupabaseServerClient,
  eventId: number,
): Promise<number> {
  const { count } = await supabase
    .from("rsvps")
    .select("*", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("status", "confirmed");
  return count ?? 0;
}

function toEmailEvent(event: EventRow, icsSequence: number): RsvpEmailEvent {
  return {
    id: event.id,
    name: event.name,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    timezone: event.timezone,
    location: event.location,
    lead_name: event.lead_name,
    lead_phone: event.lead_phone,
    lead_email: event.lead_email,
    custom_email_note: event.custom_email_note,
    occurrence_note: event.occurrence_note,
    virtual_link: event.virtual_link,
    virtual_access_notes: event.virtual_access_notes,
    ics_sequence: icsSequence,
  };
}

function sectionsLabel(ids: string[] | null | undefined): string {
  const set = new Set(ids ?? []);
  const labels = REGISTRATION_SECTIONS.filter((s) => set.has(s.id)).map((s) => s.title);
  return labels.length > 0 ? labels.join(", ") : "None";
}

function capacityLabel(n: number | null): string {
  return n == null ? "Unlimited" : String(n);
}

function buildDiff(before: EventRow, after: EventRow): EventChangeDiffEntry[] {
  const entries: EventChangeDiffEntry[] = [];
  const push = (label: string, b: string, a: string) => {
    if (b !== a) entries.push({ label, before: b, after: a });
  };

  push("Title", before.name, after.name);
  push("Public link", publicEventPath(before.slug), publicEventPath(after.slug));
  push("Event type", before.event_type ?? "", after.event_type ?? "");
  push("Chapter", before.chapter ?? "", after.chapter ?? "");
  push("Description", before.description ?? "", after.description ?? "");
  push("Occurrence note", before.occurrence_note ?? "", after.occurrence_note ?? "");
  push("Location", before.location ?? "", after.location ?? "");
  push("Meeting link", before.virtual_link ?? "", after.virtual_link ?? "");
  push("Capacity", capacityLabel(before.capacity), capacityLabel(after.capacity));
  push("Lead name", before.lead_name ?? "", after.lead_name ?? "");
  if ((before.lead_user_id ?? null) !== (after.lead_user_id ?? null)) {
    const account = (row: EventRow) =>
      row.lead_user_id ? `Linked account (${row.lead_email || row.lead_name || "no contact on file"})` : "None";
    entries.push({ label: "Lead account (manage rights)", before: account(before), after: account(after) });
  }
  push("Lead phone", before.lead_phone ?? "", after.lead_phone ?? "");
  push("Lead email", before.lead_email ?? "", after.lead_email ?? "");
  push("Custom email note", before.custom_email_note ?? "", after.custom_email_note ?? "");
  push(
    "Registration sections",
    sectionsLabel(before.registration_sections),
    sectionsLabel(after.registration_sections),
  );
  push(
    "Requires health history",
    before.requires_health_history ? "Yes" : "No",
    after.requires_health_history ? "Yes" : "No",
  );
  const stateLabel = (code: string | null) =>
    isWaiverState(code) ? WAIVER_STATES[code] : "";
  push("Waiver state", stateLabel(before.waiver_state), stateLabel(after.waiver_state));
  push(
    "When",
    formatEventDateRange(before.starts_at, before.ends_at, before.timezone),
    formatEventDateRange(after.starts_at, after.ends_at, after.timezone),
  );

  return entries;
}

export type EventEditInput = {
  name: string;
  /** A name from `event_types` (active or not — see EventTypeField), or the
   * event's existing legacy value. Changing it never re-defaults the
   * registration sections. */
  eventType: string;
  /** Must be one of lib/chapters.ts — also decides which state's waiver applies. */
  chapter: string;
  description: string;
  /** Public, shown on the events list/event page and in the confirmation
   * and reminder emails — distinct from customEmailNote below. */
  occurrenceNote: string;
  // Structured location — same fields as the create wizard. Composed into
  // events.location on save (see lib/event-location.ts).
  venueName: string;
  streetAddress: string;
  city: string;
  state: string;
  /** Optional ZIP. */
  postalCode: string;
  /** Required, ignored otherwise, when chapter is VIRTUAL_CHAPTER. */
  virtualLink: string;
  virtualAccessNotes: string;
  /** Raw form text — "" means unlimited, otherwise at least 1 (lib/event-capacity.ts). */
  capacity: string;
  leadName: string;
  leadPhone: string;
  leadEmail: string;
  /** profiles.id of the lead's account, or "" for none — that person gets
   * manage rights on the event. */
  leadUserId: string;
  customEmailNote: string;
  /** Optional section ids only (lib/registration-sections.ts) — an
   * alwaysRequired section applies to every event regardless and isn't part
   * of this list. */
  registrationSections: string[];
  /** Everyone at the event needs a current health form
   * (events.requires_health_history). */
  requiresHealthHistory: boolean;
  /** The public page's /events/<slug>. Normalized and validated on save; a
   * changed slug keeps the old one redirecting. Never carried to other
   * events in a series. */
  slug: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM", 24-hour */
  time: string;
  /** "HH:MM", 24-hour — "" means open-ended (ends_at stays null). */
  endTime: string;
  timezone: string;
  /** Every active role the form loaded, plus any added — see
   * EditableVolunteerRole for delete/cancel marks. */
  volunteerRoles: EditableVolunteerRole[];
  /** Tier 1 marketing for this occurrence only, whatever the series scope.
   * Only an admin or the chapter's lead may change it. */
  boostTier1: boolean;
};

/** How far an edit reaches, for an event in a series. "future" carries only
 * what the admin changed on this occurrence — title, description, location
 * and meeting link, capacity, lead contact, registration sections, time of
 * day (never the date), volunteer roles, and the occurrence note when
 * `applyOccurrenceNote` — onto every later scheduled occurrence. */
export type EditScopeOptions = { scope: EditScope; applyOccurrenceNote: boolean };

/** What moving an event to a chapter in a different state does to the people
 * already registered: they signed the old state's waiver, not the new one's. */
export type WaiverChangeImpact = {
  oldStateName: string;
  newStateName: string;
  /** Confirmed, waitlisted, or offered — everyone holding or awaiting a spot. */
  registeredCount: number;
  /** How many of them have a valid signature on the old state's waiver. */
  signedOldCount: number;
  /** How many already have a valid signature on the new state's waiver (so
   * won't be asked again). */
  alreadySignedNewCount: number;
  /** True when no waiver has been published yet for the new state + year. */
  newWaiverMissing: boolean;
};

/** Something the admin should confirm before an edit is saved. Returned (with
 * nothing written) until they confirm; several can apply at once. */
export type EditWarning =
  | ({ kind: "waiver"; severity: "warning" } & WaiverChangeImpact)
  | {
      kind: "capacity";
      severity: "warning" | "strong";
      newCapacity: number;
      confirmedCount: number;
      /** How many confirmed people exceed the new capacity (0 if none). */
      overBy: number;
      openOffers: number;
      /** Open offers that no longer fit and will be expired (and emailed). */
      offersDisplaced: number;
    }
  | { kind: "past_date"; severity: "warning"; registeredCount: number }
  | { kind: "sections_removed"; severity: "warning"; titles: string[] }
  | {
      kind: "sections_added";
      severity: "warning";
      registeredCount: number;
      sections: { title: string; missingCount: number }[];
    }
  | {
      kind: "series_capacity";
      severity: "warning";
      newCapacity: number;
      /** Later occurrences whose confirmed count is over the new capacity. */
      overDates: string[];
    };

export type UpdateEventResult =
  | { ok: true; needsConfirm: true; warnings: EditWarning[] }
  | { ok: true; needsNotifyDecision: true; confirmedCount: number; eventCount: number }
  | { ok: true; needsNotifyDecision: false }
  /** `field`: the form field the problem belongs to, when it's one field's
   * (lib/event-db-errors.ts) — the edit form moves focus to it. */
  | { ok: false; error: string; field?: EventFormField };

const sectionTitleById = (id: string) =>
  REGISTRATION_SECTIONS.find((s) => s.id === id)?.title ?? id;

/** The people holding or awaiting a spot, with what they've answered so far —
 * read once and reused for every warning. */
async function loadRegistrants(supabase: SupabaseServerClient, eventId: number) {
  const { data: rsvps } = await supabase
    .from("rsvps")
    .select("user_id, status")
    .eq("event_id", eventId)
    .in("status", ["confirmed", "waitlisted", "offered"]);
  const rows = (rsvps ?? []) as { user_id: string; status: string }[];
  return {
    userIds: rows.map((r) => r.user_id),
    confirmedCount: rows.filter((r) => r.status === "confirmed").length,
    offeredCount: rows.filter((r) => r.status === "offered").length,
  };
}

/** How many of these people haven't answered a section yet (per their profile). */
async function countMissingAnswers(
  supabase: SupabaseServerClient,
  sectionId: string,
  userIds: string[],
): Promise<number> {
  const section = REGISTRATION_SECTIONS.find((s) => s.id === sectionId);
  if (!section || userIds.length === 0) return 0;
  const { data: profiles } = await supabase.from("profiles").select("*").in("id", userIds);
  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));
  let missing = 0;
  for (const userId of userIds) {
    const profile = byId.get(userId);
    const values: Record<string, string> = {};
    for (const field of section.fields) {
      values[field.key] = profileValueFromColumn(field, profile?.[field.key]);
    }
    if (!isSectionComplete(section, values)) missing++;
  }
  return missing;
}

/** HH:MM of an instant in a zone, or "" for a null (open-ended) end. */
const timeOfDay = (iso: string | null, timeZone: string) =>
  iso ? toZonedDateTimeInputs(new Date(iso), timeZone).time : "";

/**
 * A later occurrence after an "all future events" edit: only the fields the
 * admin changed on the edited event carry over, so anything individually
 * adjusted on this occurrence keeps its other differences. Its date never
 * changes — a changed time of day lands on its own date, in its own zone.
 */
function applyToLaterOccurrence(
  occurrence: EventRow,
  before: EventRow,
  after: EventRow,
  applyOccurrenceNote: boolean,
): EventRow {
  const next: EventRow = { ...occurrence };
  // Arrays (registration_sections) compare as sets — reordering isn't a change.
  const normalize = (value: unknown) =>
    JSON.stringify(Array.isArray(value) ? [...value].sort() : (value ?? null));
  const changed = <K extends keyof EventRow>(key: K) => normalize(before[key]) !== normalize(after[key]);
  const copy = <K extends keyof EventRow>(...keys: K[]) => {
    if (keys.some(changed)) for (const key of keys) next[key] = after[key];
  };

  copy("name");
  copy("description");
  copy("capacity");
  copy("lead_name", "lead_user_id");
  copy("lead_phone");
  copy("lead_email");
  copy("registration_sections");
  copy("requires_health_history");
  if (applyOccurrenceNote) copy("occurrence_note");
  // Chapter only ever carries over within one state between physical
  // chapters (see isSeriesSafeChapterChange) — and only onto an occurrence
  // that's itself a physical chapter in that state, so an occurrence that was
  // individually moved elsewhere never has its waiver or format changed.
  if (changed("chapter") && isSeriesSafeChapterChange(occurrence.chapter, after.chapter)) {
    next.chapter = after.chapter;
    next.waiver_state = after.waiver_state;
  }
  // Location and meeting link move as one group — and only onto an
  // occurrence of the same kind (physical vs virtual).
  if (isVirtualChapter(occurrence.chapter) === isVirtualChapter(after.chapter)) {
    copy(
      "location",
      "venue_name",
      "street_address",
      "city",
      "state",
      "postal_code",
      "virtual_link",
      "virtual_access_notes",
    );
  }

  const date = toZonedDateTimeInputs(new Date(occurrence.starts_at), occurrence.timezone).date;
  const newStart = timeOfDay(after.starts_at, after.timezone);
  const newEnd = timeOfDay(after.ends_at, after.timezone);
  if (timeOfDay(before.starts_at, before.timezone) !== newStart) {
    next.starts_at = zonedDateTimeToUtc(date, newStart, occurrence.timezone).toISOString();
  }
  if (timeOfDay(before.ends_at, before.timezone) !== newEnd) {
    next.ends_at = newEnd ? zonedDateTimeToUtc(date, newEnd, occurrence.timezone).toISOString() : null;
  }
  return next;
}

/** Whether a chapter change leaves everything derived from the chapter alone
 * — same waiver state, and physical on both sides — so it's safe to apply
 * across a series. */
function isSeriesSafeChapterChange(from: string | null, to: string | null): boolean {
  if (isVirtualChapter(from) || isVirtualChapter(to)) return false;
  const fromState = waiverStateForChapter(from);
  return fromState != null && fromState === waiverStateForChapter(to);
}

/** A changed date/time, location, chapter, or meeting link — what attendees
 * are offered an update email (and a revised .ics) for. */
function scheduleOrPlaceChanged(before: EventRow, after: EventRow): boolean {
  return (
    before.starts_at !== after.starts_at ||
    (before.ends_at ?? null) !== (after.ends_at ?? null) ||
    (before.location ?? null) !== (after.location ?? null) ||
    (before.chapter ?? null) !== (after.chapter ?? null) ||
    (before.virtual_link ?? null) !== (after.virtual_link ?? null)
  );
}

const shortDate = (event: EventRow) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: event.timezone,
  }).format(new Date(event.starts_at));

/** Columns updateEventAction writes, from an EventRow. */
function eventUpdateColumns(row: EventRow, icsSequence: number) {
  return {
    name: row.name,
    event_type: row.event_type,
    chapter: row.chapter,
    description: row.description,
    occurrence_note: row.occurrence_note,
    location: row.location,
    venue_name: row.venue_name,
    street_address: row.street_address,
    city: row.city,
    state: row.state,
    postal_code: row.postal_code,
    virtual_link: row.virtual_link,
    virtual_access_notes: row.virtual_access_notes,
    capacity: row.capacity,
    lead_name: row.lead_name,
    lead_user_id: row.lead_user_id,
    lead_phone: row.lead_phone,
    lead_email: row.lead_email,
    custom_email_note: row.custom_email_note,
    registration_sections: row.registration_sections,
    requires_health_history: row.requires_health_history,
    waiver_state: row.waiver_state,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    timezone: row.timezone,
    // Unchanged for every row but the one being edited (later occurrences
    // keep their own); the events_slug_guard trigger retires a changed one.
    slug: row.slug,
    // Likewise: a boost never reaches past the occurrence it was set on.
    marketing_tier: row.marketing_tier,
    ics_sequence: icsSequence,
    updated_at: new Date().toISOString(),
  };
}

/** Capacity follow-ups after a save, same as a single edit always did: less
 * room expires open offers that no longer fit, more room offers spots to the
 * waitlist. */
async function settleCapacity(before: EventRow, after: EventRow) {
  if (after.capacity != null && after.capacity !== before.capacity) {
    await expireExcessOffers(after.id);
  }
  if (before.capacity != null && (after.capacity == null || after.capacity > before.capacity)) {
    await offerFreeSpots(after.id);
  }
}

/**
 * Saves an event edit. When the date, time, or location changes and the
 * event has confirmed RSVPs, this first returns needsNotifyDecision (no
 * write yet) so the UI can ask "notify attendees?" — the caller then calls
 * back with an explicit `notifyAttendees` to actually commit the change.
 * The admin change-notification email (item 4) always fires on a real
 * write, independent of that attendee-notify choice.
 *
 * Volunteer roles are saved in the same action (lib/admin/event-roles.ts),
 * and with scope "future" the edit also reaches every later scheduled
 * occurrence of the series (applyToLaterOccurrence). Everything — role
 * guards on every occurrence included — is validated before anything is
 * written.
 */
export async function updateEventAction(
  eventId: number,
  input: EventEditInput,
  notifyAttendees: boolean | null,
  /** The admin has confirmed the warnings returned by an earlier call (see
   * EditWarning). Pass true on the follow-up call to actually save. */
  confirmed = false,
  options: EditScopeOptions = { scope: "this", applyOccurrenceNote: false },
): Promise<UpdateEventResult> {
  const supabase = await createClient();
  const adminCheck = await requireEventManager(supabase, eventId);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const before = await loadEvent(supabase, eventId);
  if (!before) return { ok: false, error: "Event not found" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Event title is required", field: "title" };
  if (!input.date || !input.time) return { ok: false, error: "Date and time are required", field: "date" };

  // Blank means "keep it" — a slug is never removed (printed links).
  const slug = normalizeSlug(input.slug) || before.slug;
  if (slug !== before.slug) {
    const slugProblem = slugError(slug);
    if (slugProblem) return { ok: false, error: slugProblem, field: "slug" };
    const [{ data: takenByEvent }, { data: takenByAlias }] = await Promise.all([
      supabase.from("events").select("id").eq("slug", slug).neq("id", eventId).maybeSingle(),
      supabase
        .from("event_slug_aliases")
        .select("event_id")
        .eq("slug", slug)
        .neq("event_id", eventId)
        .maybeSingle(),
    ]);
    if (takenByEvent || takenByAlias) {
      return { ok: false, error: `The link /events/${slug} is already used by another event`, field: "slug" };
    }
  }
  if (!input.timezone) return { ok: false, error: "Time zone is required", field: "timezone" };

  // One rule with the create wizard: blank = unlimited, otherwise at least 1.
  const capacityProblem = capacityError(input.capacity);
  if (capacityProblem) return { ok: false, error: capacityProblem, field: "capacity" };
  const capacity = parseCapacity(input.capacity);

  // Event type: any event_types row (active or not — the edit form offers
  // both, so an already-deactivated type stays selectable), or left
  // unchanged (an older event may carry a value that predates the table
  // entirely).
  // Moving an event is creating it somewhere else: only into a chapter the
  // caller leads (can_manage_chapter — events_chapter_guard enforces it too).
  if (input.chapter !== before.chapter) {
    const { data: canMove } = await supabase.rpc("can_manage_chapter", { p_chapter: input.chapter });
    if (!canMove) return { ok: false, error: "You can only move an event to a chapter you lead", field: "chapter" };
  }
  if (input.leadUserId && !UUID_PATTERN.test(input.leadUserId)) {
    return { ok: false, error: "Choose the lead again" };
  }

  if (input.eventType !== before.event_type) {
    const { data: eventTypeRow } = await supabase
      .from("event_types")
      .select("id")
      .eq("name", input.eventType)
      .maybeSingle();
    if (!eventTypeRow) return { ok: false, error: "Choose an event type", field: "event_type" };
  }

  const validSectionIds = new Set(
    REGISTRATION_SECTIONS.filter((s) => !s.alwaysRequired && !s.profileOnly).map((s) => s.id),
  );
  const registrationSections = input.registrationSections.filter((id) => validSectionIds.has(id));

  // The chapter also decides the waiver: its state is never a separate
  // choice, it always follows the chapter.
  if (!CHAPTERS.some((c) => c.name === input.chapter) && !isVirtualChapter(input.chapter)) {
    return { ok: false, error: "Choose a chapter" };
  }
  const waiverState = waiverStateForChapter(input.chapter);
  const isVirtual = isVirtualChapter(input.chapter);

  // Same fields and rule as the create wizard. An older event that only
  // has free text keeps it if the admin leaves them all blank. A virtual
  // event skips physical-location validation entirely and needs a meeting
  // link instead.
  const virtualLink = input.virtualLink.trim();
  const virtualAccessNotes = input.virtualAccessNotes.trim();
  if (isVirtual) {
    if (!virtualLink) return { ok: false, error: "A meeting link is required for a virtual event", field: "virtual_link" };
  } else {
    const locationProblems = locationErrors(input, { allowLegacyEmpty: true });
    if (locationProblems.length > 0) return { ok: false, error: locationProblems.join("; "), field: "venue" };
  }
  const keepLegacyLocation = !isVirtual && isLocationEmpty(input);

  const newStarts = zonedDateTimeToUtc(input.date, input.time, input.timezone);

  let newEnds: Date | null = null;
  if (input.endTime.trim()) {
    newEnds = zonedDateTimeToUtc(input.date, input.endTime, input.timezone);
    if (newEnds.getTime() <= newStarts.getTime()) {
      return { ok: false, error: "End time must be after the start time", field: "time" };
    }
  }

  const after: EventRow = {
    ...before,
    name,
    event_type: input.eventType,
    chapter: input.chapter,
    description: input.description.trim() || null,
    occurrence_note: input.occurrenceNote.trim() || null,
    // Physical location and virtual details are mutually exclusive — moving
    // an event to/from "Virtual" clears whichever side no longer applies
    // instead of leaving a stale address or link behind.
    location: isVirtual ? null : keepLegacyLocation ? before.location : composeLocation(input),
    venue_name: isVirtual ? null : keepLegacyLocation ? before.venue_name : input.venueName.trim(),
    street_address: isVirtual
      ? null
      : keepLegacyLocation
        ? before.street_address
        : input.streetAddress.trim(),
    city: isVirtual ? null : keepLegacyLocation ? before.city : input.city.trim(),
    state: isVirtual ? null : keepLegacyLocation ? before.state : input.state.trim(),
    postal_code: isVirtual
      ? null
      : keepLegacyLocation
        ? before.postal_code
        : input.postalCode.trim() || null,
    virtual_link: isVirtual ? virtualLink : null,
    virtual_access_notes: isVirtual ? virtualAccessNotes || null : null,
    capacity,
    lead_name: input.leadName.trim() || null,
    lead_user_id: input.leadUserId || null,
    lead_phone: input.leadPhone.trim() || null,
    lead_email: input.leadEmail.trim() || null,
    custom_email_note: input.customEmailNote.trim() || null,
    registration_sections: registrationSections,
    requires_health_history: input.requiresHealthHistory === true,
    waiver_state: waiverState,
    starts_at: newStarts.toISOString(),
    ends_at: newEnds ? newEnds.toISOString() : null,
    timezone: input.timezone,
    slug,
    // Unticking clears Tier 1; a tier 2/3 set some other way is left alone.
    marketing_tier: input.boostTier1 ? 1 : before.marketing_tier === 1 ? null : before.marketing_tier,
  };

  // Tier 1 boost: only an admin or the chapter's lead may change it, and one
  // Tier 1 event per chapter per month — checked now, before any warnings,
  // so the refusal names the event already holding the month.
  // events_marketing_guard enforces both again on save.
  if (after.marketing_tier !== before.marketing_tier) {
    const { data: canBoost } = await supabase.rpc("can_manage_chapter", { p_chapter: after.chapter });
    if (!canBoost) {
      return {
        ok: false,
        error: "Only an admin or a chapter lead for this chapter can change the marketing boost",
        field: "boost",
      };
    }
  }
  if (
    after.marketing_tier === 1 &&
    after.status !== "cancelled" &&
    (before.marketing_tier !== 1 ||
      before.chapter !== after.chapter ||
      before.starts_at !== after.starts_at ||
      before.timezone !== after.timezone)
  ) {
    const { data: conflict, error: conflictError } = await supabase.rpc("tier1_boost_conflict_message", {
      p_event_id: eventId,
      p_chapter: after.chapter,
      p_starts_at: after.starts_at,
      p_timezone: after.timezone,
    });
    if (conflictError) {
      const problem = friendlyEventDbError(conflictError, `boost check event ${eventId}`);
      return { ok: false, error: problem.message, field: problem.field };
    }
    if (conflict) return { ok: false, error: conflict as string, field: "boost" };
  }

  // A chapter change counts like a location change: attendees are offered the
  // "notify" choice for it too. A changed meeting link is the virtual
  // equivalent of a changed physical location — same treatment, so the .ics
  // (LOCATION/DESCRIPTION — see lib/email/ics.ts) gets updated and attendees
  // can be told.
  const chapterChanged = (before.chapter ?? null) !== (after.chapter ?? null);
  const dateTimeOrLocationChanged = scheduleOrPlaceChanged(before, after);

  // --- Series scope: which later occurrences this edit also reaches ---
  const laterPairs: { before: EventRow; after: EventRow }[] = [];
  if (options.scope === "future") {
    if (!before.series_id) return { ok: false, error: "This event isn't part of a series" };
    // Chapter decides the waiver state and physical-vs-virtual. A move within
    // one state between physical chapters (Denver -> CO Springs) changes
    // neither, so it can carry across the series. Crossing states or moving
    // to/from Virtual would change the waiver or the format for everyone
    // already registered on every later date, so that stays per-event.
    if (chapterChanged && !isSeriesSafeChapterChange(before.chapter, after.chapter)) {
      const crossesVirtual = isVirtualChapter(before.chapter) || isVirtualChapter(after.chapter);
      return {
        ok: false,
        error: crossesVirtual
          ? 'Moving to or from Virtual can only be saved for "This event only" — it would switch the event between in-person and virtual for everyone already registered across the series. Save the chapter change on its own first, then make the series-wide changes.'
          : 'Moving to a chapter in another state can only be saved for "This event only" — it would change which state\'s waiver applies for everyone already registered across the series. Save the chapter change on its own first, then make the series-wide changes.',
      };
    }
    for (const occurrence of await loadLaterOccurrences(supabase, before)) {
      const next = applyToLaterOccurrence(occurrence, before, after, options.applyOccurrenceNote);
      if (next.ends_at && new Date(next.ends_at).getTime() <= new Date(next.starts_at).getTime()) {
        return {
          ok: false,
          error: `On ${shortDate(occurrence)} the end time would be before the start time — adjust that occurrence first`,
        };
      }
      laterPairs.push({ before: occurrence, after: next });
    }
  }

  // --- Volunteer roles: plan every write, on every occurrence, up front ---
  const existingRoles = await loadActiveRoles(supabase, [
    eventId,
    ...laterPairs.map((p) => p.before.id),
  ]);
  const rolesOf = (id: number): ExistingRole[] => existingRoles.filter((r) => r.event_id === id);
  const { data: roleTypeRows } = await supabase.from("volunteer_role_types").select("id, name");
  const roleTypeNames = new Map((roleTypeRows ?? []).map((rt) => [rt.id as number, rt.name as string]));

  const eventRolePlan = planEventRoles(input.volunteerRoles, rolesOf(eventId), after, roleTypeNames);
  const rolePlans: RolePlan[] = [
    eventRolePlan,
    ...laterPairs.map((p) =>
      planSiblingRoles(input.volunteerRoles, rolesOf(eventId), before.timezone, rolesOf(p.before.id), p.after),
    ),
  ];
  const roleErrors = rolePlans.flatMap((p) => p.errors);
  if (roleErrors.length > 0) return { ok: false, error: roleErrors.join(". "), field: "roles" };
  const roleOps: RoleOp[] = rolePlans.flatMap((p) => p.ops);

  // Anything the admin should confirm first — nothing is written until they do.
  if (!confirmed) {
    const warnings: EditWarning[] = [];
    const registrants = await loadRegistrants(supabase, eventId);

    // Moving to a chapter in the other state (CO <-> GA) swaps the waiver:
    // registered people signed the old state's, so they'll need to sign the new
    // one. Within the same state (Denver -> CO Springs) nothing changes for them.
    if (before.waiver_state !== after.waiver_state) {
      const impact = await waiverChangeImpact(supabase, before, after);
      if (impact) warnings.push({ kind: "waiver", severity: "warning", ...impact });
    }

    // Lowering capacity: nobody is removed, but confirmed people can end up over
    // the new limit, and open waitlist offers that no longer fit get expired.
    if (after.capacity != null && after.capacity !== before.capacity) {
      const overBy = Math.max(registrants.confirmedCount - after.capacity, 0);
      const room = Math.max(after.capacity - registrants.confirmedCount, 0);
      const offersDisplaced = Math.max(registrants.offeredCount - room, 0);
      if (overBy > 0 || offersDisplaced > 0) {
        warnings.push({
          kind: "capacity",
          severity: offersDisplaced > 0 ? "strong" : "warning",
          newCapacity: after.capacity,
          confirmedCount: registrants.confirmedCount,
          overBy,
          openOffers: registrants.offeredCount,
          offersDisplaced,
        });
      }

      // The same capacity carried to later occurrences: nobody is removed
      // there either, and their own over-capacity open offers are withdrawn.
      const overDates: string[] = [];
      for (const pair of laterPairs) {
        if (pair.after.capacity == null || pair.after.capacity === pair.before.capacity) continue;
        const later = await loadRegistrants(supabase, pair.before.id);
        if (later.confirmedCount + later.offeredCount > pair.after.capacity) {
          overDates.push(shortDate(pair.before));
        }
      }
      if (overDates.length > 0) {
        warnings.push({
          kind: "series_capacity",
          severity: "warning",
          newCapacity: after.capacity,
          overDates,
        });
      }
    }

    // Moving the start into the past for an event people have signed up for.
    if (
      before.starts_at !== after.starts_at &&
      new Date(after.starts_at).getTime() < Date.now() &&
      registrants.userIds.length > 0
    ) {
      warnings.push({
        kind: "past_date",
        severity: "warning",
        registeredCount: registrants.userIds.length,
      });
    }

    // Registration sections: removing stops collecting them; adding leaves
    // people who already registered without an answer.
    const beforeSections = new Set(before.registration_sections ?? []);
    const afterSections = new Set(after.registration_sections ?? []);
    const removed = [...beforeSections].filter((id) => !afterSections.has(id));
    const added = [...afterSections].filter((id) => !beforeSections.has(id));
    if (removed.length > 0) {
      warnings.push({
        kind: "sections_removed",
        severity: "warning",
        titles: removed.map(sectionTitleById),
      });
    }
    if (added.length > 0 && registrants.userIds.length > 0) {
      warnings.push({
        kind: "sections_added",
        severity: "warning",
        registeredCount: registrants.userIds.length,
        sections: await Promise.all(
          added.map(async (id) => ({
            title: sectionTitleById(id),
            missingCount: await countMissingAnswers(supabase, id, registrants.userIds),
          })),
        ),
      });
    }

    if (warnings.length > 0) return { ok: true, needsConfirm: true, warnings };
  }

  // Every occurrence whose date/time or place changes — the edited one and
  // any later ones this reaches.
  const rescheduled = [
    ...(dateTimeOrLocationChanged ? [{ before, after }] : []),
    ...laterPairs.filter((p) => scheduleOrPlaceChanged(p.before, p.after)),
  ];

  if (rescheduled.length > 0 && notifyAttendees === null) {
    let confirmedCount = 0;
    for (const pair of rescheduled) {
      confirmedCount += await countConfirmedRsvps(supabase, pair.before.id);
    }
    if (confirmedCount > 0) {
      return {
        ok: true,
        needsNotifyDecision: true,
        confirmedCount,
        eventCount: rescheduled.length,
      };
    }
  }

  const newSequence = dateTimeOrLocationChanged ? before.ics_sequence + 1 : before.ics_sequence;

  const { error: updateError } = await supabase
    .from("events")
    .update(eventUpdateColumns(after, newSequence))
    .eq("id", eventId);
  if (updateError) {
    // 23505: the slug was taken between the check above and this write.
    if (updateError.code === "23505") {
      return { ok: false, error: `The link /events/${slug} is already used by another event`, field: "slug" };
    }
    const problem = friendlyEventDbError(updateError, `update event ${eventId}`);
    return { ok: false, error: problem.message, field: problem.field };
  }
  await settleCapacity(before, after);

  const laterSequences = new Map<number, number>();
  for (const pair of laterPairs) {
    const sequence = scheduleOrPlaceChanged(pair.before, pair.after)
      ? pair.before.ics_sequence + 1
      : pair.before.ics_sequence;
    laterSequences.set(pair.before.id, sequence);
    const { error } = await supabase
      .from("events")
      .update(eventUpdateColumns(pair.after, sequence))
      .eq("id", pair.before.id);
    if (error) {
      return {
        ok: false,
        error: `Saved this event, but updating ${shortDate(pair.before)} failed (${friendlyEventDbError(error, `update series occurrence ${pair.before.id}`).message}) — later occurrences weren't changed`,
      };
    }
    await settleCapacity(pair.before, pair.after);
  }

  const roleResult = await executeRoleOps(
    supabase,
    roleOps,
    new Map([after, ...laterPairs.map((p) => p.after)].map((e) => [e.id, e])),
  );
  if (roleResult.error) {
    return {
      ok: false,
      error: `Saved the event details, but volunteer roles didn't all save: ${roleResult.error}`,
      field: "roles",
    };
  }

  if (notifyAttendees === true) {
    for (const pair of rescheduled) {
      const sequence = pair.before.id === eventId ? newSequence : (laterSequences.get(pair.before.id) as number);
      await notifyRescheduled(supabase, pair.before, pair.after, sequence);
    }
  }

  try {
    const diff = [...buildDiff(before, after), ...eventRolePlan.diff];
    if (laterPairs.length > 0) {
      diff.push({
        label: "Applied to",
        before: "",
        after: `This occurrence and ${laterPairs.length} later ${laterPairs.length === 1 ? "occurrence" : "occurrences"} in the series (${laterPairs.map((p) => shortDate(p.before)).join(", ")})`,
      });
    }
    if (diff.length > 0) {
      await sendAdminChangeNotificationEmail({
        action: "edited",
        actorLabel: actorLabel(adminCheck.actor),
        eventName: after.name,
        eventId: after.id,
        chapter: after.chapter,
        diff,
      });
    }
  } catch (err) {
    console.error(`Failed to send admin change notification for event ${eventId} edit:`, err);
  }

  return { ok: true, needsNotifyDecision: false };
}

/** Update email (with a revised .ics) to every confirmed attendee of one
 * rescheduled or moved occurrence. Failures are logged per recipient. */
async function notifyRescheduled(
  supabase: SupabaseServerClient,
  before: EventRow,
  after: EventRow,
  icsSequence: number,
) {
  const eventId = after.id;
  try {
    const attendees = await confirmedAttendees(supabase, eventId);
    const emailEvent = toEmailEvent(after, icsSequence);

    // When the update moved the event to the other state's waiver, tell the
    // attendees who still have to sign it (anyone who already signed the new
    // state's waiver for this year gets the usual wording).
    let signedNewWaiver = new Set<string>();
    const waiverStateChanged = before.waiver_state !== after.waiver_state;
    if (waiverStateChanged) {
      const requirement = await resolveEventWaiver(supabase, after);
      if (requirement.kind === "ok" && attendees.length > 0) {
        const { data: signatures } = await supabase
          .from("waiver_signatures")
          .select("user_id")
          .eq("waiver_id", requirement.waiver.id)
          .in(
            "user_id",
            attendees.map((a) => a.userId),
          );
        signedNewWaiver = new Set((signatures ?? []).map((s) => s.user_id as string));
      }
    }
    const newWaiverStateName =
      waiverStateChanged && isWaiverState(after.waiver_state)
        ? WAIVER_STATES[after.waiver_state]
        : undefined;

    for (const { userId, email: toEmail } of attendees) {
      try {
        await sendEventUpdateEmail({
          event: emailEvent,
          toEmail,
          newWaiverStateName: signedNewWaiver.has(userId) ? undefined : newWaiverStateName,
        });
      } catch (err) {
        console.error(
          `Failed to send event-update email to ${toEmail} for event ${eventId}:`,
          err,
        );
      }
    }
  } catch (err) {
    console.error(`Failed to notify attendees of event ${eventId} update:`, err);
  }
}

export type CancelPreviewResult =
  | {
      ok: true;
      subject: string;
      html: string;
      text: string;
      recipientCount: number;
      /** Confirmed volunteer signups that are cancelled (and emailed) too. */
      volunteerCount: number;
      /** How many occurrences this cancels (1 unless scope is "future"). */
      eventCount: number;
      /** Their dates, soonest first. */
      eventDates: string[];
    }
  | { ok: false; error: string };

/** The occurrences a cancel reaches: this one (if still scheduled) and, for
 * "future", every later scheduled occurrence in its series. */
async function eventsToCancel(
  supabase: SupabaseServerClient,
  event: EventRow,
  scope: EditScope,
): Promise<EventRow[]> {
  const events = event.status === "scheduled" ? [event] : [];
  if (scope === "future") events.push(...(await loadLaterOccurrences(supabase, event)));
  return events;
}

/** Renders the exact cancellation email (for this occurrence — the others
 * get the same text with their own date) and counts recipients across every
 * occurrence it reaches — no writes, no sends. Backs the admin cancel flow's
 * required preview step. */
export async function previewEventCancellationAction(
  eventId: number,
  reason: string,
  scope: EditScope = "this",
): Promise<CancelPreviewResult> {
  const supabase = await createClient();
  const adminCheck = await requireEventManager(supabase, eventId);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const trimmedReason = reason.trim();
  if (!trimmedReason) return { ok: false, error: "A cancellation reason is required" };

  const event = await loadEvent(supabase, eventId);
  if (!event) return { ok: false, error: "Event not found" };
  if (scope === "future" && !event.series_id) {
    return { ok: false, error: "This event isn't part of a series" };
  }

  const events = await eventsToCancel(supabase, event, scope);
  if (events.length === 0) return { ok: false, error: "There's nothing scheduled left to cancel" };
  let recipientCount = 0;
  for (const e of events) {
    recipientCount += (await confirmedRsvpEmails(supabase, e.id)).length;
  }
  const { subject, html, text } = previewEventCancellationEmail(
    toEmailEvent(events[0], events[0].ics_sequence + 1),
    trimmedReason,
  );
  const people = await peopleByEvent(
    supabase,
    events.map((e) => e.id),
  );

  return {
    ok: true,
    subject,
    html,
    text,
    recipientCount,
    volunteerCount: sumPeople(people.values()).volunteers,
    eventCount: events.length,
    eventDates: events.map(shortDate),
  };
}

export type CancelEventResult =
  | { ok: true; cancelledCount: number; volunteerSignupsCancelled: number }
  | { ok: false; error: string };

/**
 * Cancels the event (status -> 'cancelled', bumped ics_sequence) and emails
 * every confirmed attendee a METHOD:CANCEL update plus the admin
 * notification list — always, regardless of who's on that list. With scope
 * "future", does the same for every later scheduled occurrence in the
 * series, each attendee getting the same reason for their own occurrence;
 * the admin list gets one notification covering all of them.
 */
export async function cancelEventAction(
  eventId: number,
  reason: string,
  scope: EditScope = "this",
): Promise<CancelEventResult> {
  const supabase = await createClient();
  const adminCheck = await requireEventManager(supabase, eventId);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const trimmedReason = reason.trim();
  if (!trimmedReason) return { ok: false, error: "A cancellation reason is required" };

  const anchor = await loadEvent(supabase, eventId);
  if (!anchor) return { ok: false, error: "Event not found" };
  if (scope === "future" && !anchor.series_id) {
    return { ok: false, error: "This event isn't part of a series" };
  }

  const events = await eventsToCancel(supabase, anchor, scope);
  if (events.length === 0) return { ok: false, error: "There's nothing scheduled left to cancel" };

  const cancelled: EventRow[] = [];
  let volunteerSignupsCancelled = 0;
  const volunteerErrors: string[] = [];
  for (const before of events) {
    const newSequence = before.ics_sequence + 1;
    // Shared with the volunteer signups cancelled below, so a restore can
    // tell exactly which ones went with the event.
    const cancelledAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("events")
      .update({
        status: "cancelled",
        cancellation_reason: trimmedReason,
        cancelled_at: cancelledAt,
        ics_sequence: newSequence,
        updated_at: cancelledAt,
      })
      .eq("id", before.id)
      .eq("status", "scheduled");
    if (updateError) {
      if (cancelled.length === 0) return { ok: false, error: updateError.message };
      console.error(`Failed to cancel event ${before.id} in series cancel:`, updateError);
      break;
    }
    cancelled.push(before);

    // Volunteers too — otherwise people show up to a cancelled event for a
    // shift that no longer exists.
    const volunteerResult = await cancelEventVolunteerSignups(supabase, before, trimmedReason, cancelledAt);
    volunteerSignupsCancelled += volunteerResult.cancelledCount;
    if (volunteerResult.error) {
      console.error(`Failed to cancel volunteer signups for event ${before.id}:`, volunteerResult.error);
      volunteerErrors.push(`${shortDate(before)}: ${volunteerResult.error}`);
    }

    const emailEvent = toEmailEvent(before, newSequence);
    try {
      const emails = await confirmedRsvpEmails(supabase, before.id);
      for (const toEmail of emails) {
        try {
          await sendEventCancellationEmail({ event: emailEvent, toEmail, reason: trimmedReason });
        } catch (err) {
          console.error(
            `Failed to send event-cancellation email to ${toEmail} for event ${before.id}:`,
            err,
          );
        }
      }
    } catch (err) {
      console.error(`Failed to notify attendees of event ${before.id} cancellation:`, err);
    }
  }

  try {
    const diff: EventChangeDiffEntry[] = [{ label: "Status", before: "Scheduled", after: "Cancelled" }];
    if (volunteerSignupsCancelled > 0) {
      diff.push({
        label: "Volunteer signups",
        before: `${volunteerSignupsCancelled} confirmed`,
        after: "Cancelled and emailed",
      });
    }
    if (scope === "future") {
      diff.push({
        label: "Occurrences cancelled",
        before: "",
        after: `${cancelled.length}: ${cancelled.map(shortDate).join(", ")}`,
      });
    }
    await sendAdminChangeNotificationEmail({
      action: "cancelled",
      actorLabel: actorLabel(adminCheck.actor),
      eventName: anchor.name,
      eventId: anchor.id,
      chapter: anchor.chapter,
      diff,
      reason: trimmedReason,
    });
  } catch (err) {
    console.error(
      `Failed to send admin change notification for event ${eventId} cancellation:`,
      err,
    );
  }

  if (cancelled.length < events.length) {
    return {
      ok: false,
      error: `Cancelled ${cancelled.length} of ${events.length} occurrences before an error — the rest are still scheduled. Try again to finish.`,
    };
  }
  if (volunteerErrors.length > 0) {
    return {
      ok: false,
      error: `The event was cancelled and attendees emailed, but volunteer signups couldn't be cancelled (${volunteerErrors.join("; ")}). Remove those volunteers from the roster by hand.`,
    };
  }
  return { ok: true, cancelledCount: cancelled.length, volunteerSignupsCancelled };
}

export type RestoreEventResult = { ok: true } | { ok: false; error: string };

/**
 * Restores a cancelled event: status -> 'scheduled', reason cleared, bumped
 * ics_sequence. Optionally emails everyone who has a confirmed RSVP (their
 * row was never touched by the cancellation, so this is still accurate) a
 * fresh METHOD:REQUEST so the event reappears on their calendar. The admin
 * notification fires either way, same as edit/cancel.
 *
 * Volunteer shifts are NOT restored: cancelling the event cancelled those
 * signups and told each volunteer not to come, so silently re-confirming
 * them would count people who may have made other plans. Their roles are
 * open again instead, and `notifyVolunteers` emails them that the event is
 * back on and they can sign up again.
 */
export async function restoreEventAction(
  eventId: number,
  notifyAttendees: boolean,
  notifyVolunteers = false,
): Promise<RestoreEventResult> {
  const supabase = await createClient();
  const adminCheck = await requireEventManager(supabase, eventId);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const before = await loadEvent(supabase, eventId);
  if (!before) return { ok: false, error: "Event not found" };
  if (before.status !== "cancelled") return { ok: false, error: "Event is not cancelled" };

  const newSequence = before.ics_sequence + 1;
  // Read before the update clears cancelled_at, which is how these are found.
  const volunteersCancelled = await countSignupsCancelledWithEvent(
    supabase,
    eventId,
    before.cancelled_at,
  );

  const { error: updateError } = await supabase
    .from("events")
    .update({
      status: "scheduled",
      cancellation_reason: null,
      cancelled_at: null,
      ics_sequence: newSequence,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId);
  if (updateError) return { ok: false, error: updateError.message };

  const emailEvent = toEmailEvent(before, newSequence);

  if (notifyAttendees) {
    try {
      const emails = await confirmedRsvpEmails(supabase, eventId);
      for (const toEmail of emails) {
        try {
          await sendEventRestoredEmail({ event: emailEvent, toEmail });
        } catch (err) {
          console.error(
            `Failed to send event-restored email to ${toEmail} for event ${eventId}:`,
            err,
          );
        }
      }
    } catch (err) {
      console.error(`Failed to notify attendees of event ${eventId} restore:`, err);
    }
  }

  if (notifyVolunteers && volunteersCancelled > 0) {
    try {
      await emailVolunteersEventRestored(supabase, before, before.cancelled_at);
    } catch (err) {
      console.error(`Failed to email volunteers about event ${eventId} restore:`, err);
    }
  }

  try {
    const diff: EventChangeDiffEntry[] = [{ label: "Status", before: "Cancelled", after: "Scheduled" }];
    if (before.cancellation_reason) {
      diff.push({ label: "Cancellation reason", before: before.cancellation_reason, after: "" });
    }
    if (volunteersCancelled > 0) {
      diff.push({
        label: "Volunteer signups",
        before: `${volunteersCancelled} cancelled with the event`,
        after: notifyVolunteers
          ? "Not restored — emailed to sign up again"
          : "Not restored — not emailed",
      });
    }
    await sendAdminChangeNotificationEmail({
      action: "restored",
      actorLabel: actorLabel(adminCheck.actor),
      eventName: before.name,
      eventId: before.id,
      chapter: before.chapter,
      diff,
    });
  } catch (err) {
    console.error(`Failed to send admin change notification for event ${eventId} restore:`, err);
  }

  return { ok: true };
}
