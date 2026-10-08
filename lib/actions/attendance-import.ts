"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { assignLeadEventsToNewAccount } from "@/lib/admin/lead-account";
import { findProfileByEmail } from "@/lib/profile-lookup";
import { zonedDateTimeToUtc } from "@/lib/timezone";
import { normalizeName } from "@/lib/volunteer-import";
import {
  ATTENDANCE_CHUNK_SIZE,
  ATTENDANCE_MAX_ROWS,
  checkAttendanceRow,
  eventKey,
  type AttendanceRowInput,
  type CheckedAttendanceRow,
} from "@/lib/attendance-import";

/**
 * Setup → Import attendance, the database side (see lib/attendance-import.ts
 * and the 2026-10-08 "Attendance import" entry in schema-changes.sql).
 * Admins only. Every row is re-checked and re-matched here for both the
 * preview and the write; the write never trusts the preview it was
 * confirmed from. Running the same file twice changes nothing the second
 * time: people match by email, events by chapter and date, and
 * import_attendance_row skips attendance that's already recorded.
 *
 *  - People: matched by normalized email. A match only has its blank name,
 *    phone and home chapter filled in. Otherwise an account is made the way
 *    a walk-up makes one (confirmed, no password, no email sent, no
 *    walk-up welcome).
 *  - Events: the one the event_chapter ran on event_date (its own time
 *    zone). Two that day are told apart by event_name. None: a minimal past
 *    event is made (name, chapter, date at noon; unpublished; imported_at).
 *  - Attendance: import_attendance_row — a checked-in RSVP, or a served
 *    shift, dated to the event. No waiver signature is ever created.
 *  - heard_about: profiles have no field for it, so it isn't stored. notes
 *    are only shown in the preview.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

type Chapter = { name: string; timezone: string; state: string | null };
type Profile = { id: string; email: string; first_name: string | null; last_name: string | null; phone: string | null; chapter: string | null };
type EventRow = { id: number; name: string; chapter: string; starts_at: string; timezone: string; status: string; imported_at: string | null };

export type PlanRowAction = "import" | "already" | "skip";

export type AttendancePlanRow = CheckedAttendanceRow & {
  action: PlanRowAction;
  /** Why it's skipped (or already recorded). */
  reason: string;
  person: "new" | "matched" | null;
  event: "new" | "matched" | null;
  /** "Knot Just Fly Tying · CO Springs · 2025-10-02" */
  eventLabel: string;
  /** volunteered, and they have no volunteer record. */
  noVolunteerRecord: boolean;
};

export type AttendancePlanPerson = {
  email: string;
  name: string;
  status: "new" | "matched";
  /** matched: blank profile fields this file fills (labels). */
  fills: string[];
  rows: number;
};

export type AttendancePlanEvent = {
  key: string;
  status: "new" | "matched";
  name: string;
  chapter: string;
  date: string;
  rows: number;
  /** matched: it was made by an earlier import. */
  previouslyImported: boolean;
};

export type AttendancePlan = {
  rows: AttendancePlanRow[];
  people: AttendancePlanPerson[];
  events: AttendancePlanEvent[];
  heardAboutDropped: boolean;
};

const blank = (value: string | null | undefined) => !value || !value.trim();

/** YYYY-MM-DD of an instant in a time zone. */
function localDate(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(
    new Date(instant),
  );
}

function shiftDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The blank fields a row would fill on a matched profile (never overwrites). */
function fillsFor(profile: Profile, row: CheckedAttendanceRow): Record<string, string> {
  const fills: Record<string, string> = {};
  if (blank(profile.first_name) && row.firstName) fills.first_name = row.firstName;
  if (blank(profile.last_name) && row.lastName) fills.last_name = row.lastName;
  if (blank(profile.phone) && row.phone) fills.phone = row.phone;
  if (blank(profile.chapter) && row.homeChapter) fills.chapter = row.homeChapter;
  return fills;
}

const FILL_LABELS: Record<string, string> = { first_name: "first name", last_name: "last name", phone: "phone", chapter: "home chapter" };

async function buildPlan(admin: AdminClient, inputs: AttendanceRowInput[]): Promise<
  | {
      plan: AttendancePlan;
      chapters: Map<string, Chapter>;
      profileByEmail: Map<string, Profile>;
      eventByKey: Map<string, EventRow>;
    }
  | { error: string }
> {
  const { data: chapterRows, error: chapterError } = await admin.from("chapters").select("name, timezone, state");
  if (chapterError) return { error: chapterError.message };
  const chapters = new Map(((chapterRows ?? []) as Chapter[]).map((c) => [c.name, c]));
  const checked = inputs.map((row) => checkAttendanceRow(row, [...chapters.keys()]));

  // People, by normalized email (profiles.email is stored normalized).
  const emails = [...new Set(checked.filter((r) => r.problems.length === 0).map((r) => r.email))];
  const profileByEmail = new Map<string, Profile>();
  for (let i = 0; i < emails.length; i += 200) {
    const { data, error } = await admin
      .from("profiles")
      .select("id, email, first_name, last_name, phone, chapter")
      .in("email", emails.slice(i, i + 200));
    if (error) return { error: error.message };
    for (const p of (data ?? []) as Profile[]) profileByEmail.set(p.email, p);
  }
  const profileIds = [...profileByEmail.values()].map((p) => p.id);
  const volunteerIds = new Set<string>();
  for (let i = 0; i < profileIds.length; i += 200) {
    const { data, error } = await admin.from("volunteers").select("user_id").in("user_id", profileIds.slice(i, i + 200));
    if (error) return { error: error.message };
    for (const v of data ?? []) volunteerIds.add(v.user_id as string);
  }

  // Events on the file's chapters and dates (a day's slack each side for
  // time zones; the local date decides).
  const dated = checked.filter((r) => r.eventDate && r.eventChapter);
  const eventsByKey = new Map<string, EventRow[]>();
  if (dated.length > 0) {
    const dates = dated.map((r) => r.eventDate).sort();
    const chapterNames = [...new Set(dated.map((r) => r.eventChapter))];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("events")
        .select("id, name, chapter, starts_at, timezone, status, imported_at")
        .in("chapter", chapterNames)
        .gte("starts_at", `${shiftDate(dates[0], -1)}T00:00:00Z`)
        .lte("starts_at", `${shiftDate(dates[dates.length - 1], 2)}T00:00:00Z`)
        .order("id")
        .range(from, from + 999);
      if (error) return { error: error.message };
      for (const e of (data ?? []) as EventRow[]) {
        const key = eventKey(e.chapter, localDate(e.starts_at, e.timezone));
        eventsByKey.set(key, [...(eventsByKey.get(key) ?? []), e]);
      }
      if ((data ?? []).length < 1000) break;
    }
  }

  const rows: AttendancePlanRow[] = [];
  const people = new Map<string, AttendancePlanPerson>();
  const events = new Map<string, AttendancePlanEvent>();
  const eventByKey = new Map<string, EventRow>();
  const seen = new Map<string, number>();

  for (const row of checked) {
    const base = {
      ...row,
      person: null,
      event: null,
      eventLabel: [row.eventName, row.eventChapter, row.eventDate].filter(Boolean).join(" · "),
      noVolunteerRecord: false,
    };
    if (row.problems.length > 0) {
      rows.push({ ...base, action: "skip", reason: row.problems.join("; ") });
      continue;
    }
    const dupeKey = `${row.email}|${row.eventChapter}|${row.eventDate}|${row.role}`;
    const earlier = seen.get(dupeKey);
    if (earlier != null) {
      rows.push({ ...base, action: "skip", reason: `Same person, event and role as row ${earlier}` });
      continue;
    }
    seen.set(dupeKey, row.rowNumber);

    // The event.
    const key = eventKey(row.eventChapter, row.eventDate);
    const candidates = eventsByKey.get(key) ?? [];
    const live = candidates.filter((e) => e.status !== "cancelled");
    let event: EventRow | null = null;
    let eventStatus: "new" | "matched";
    if (live.length === 1) event = live[0];
    else if (live.length > 1) {
      const byName = live.filter((e) => normalizeName(e.name) === normalizeName(row.eventName));
      if (byName.length !== 1) {
        rows.push({
          ...base,
          action: "skip",
          reason: `${live.length} ${row.eventChapter} events on ${row.eventDate} (${live.map((e) => e.name).join(", ")}); event_name has to match one of them exactly`,
        });
        continue;
      }
      event = byName[0];
    } else if (candidates.length > 0) {
      rows.push({ ...base, action: "skip", reason: `The ${row.eventChapter} event on ${row.eventDate} was cancelled` });
      continue;
    }
    if (event) {
      eventStatus = "matched";
      eventByKey.set(key, event);
    } else {
      const planned = events.get(key);
      if (!planned && !row.eventName) {
        rows.push({ ...base, action: "skip", reason: `No ${row.eventChapter} event on ${row.eventDate}, and no event_name to create one` });
        continue;
      }
      eventStatus = "new";
    }
    const eventName = event?.name ?? events.get(key)?.name ?? row.eventName;
    const planEvent = events.get(key) ?? {
      key,
      status: eventStatus,
      name: eventName,
      chapter: row.eventChapter,
      date: row.eventDate,
      rows: 0,
      previouslyImported: Boolean(event?.imported_at),
    };
    planEvent.rows += 1;
    events.set(key, planEvent);

    // The person.
    const profile = profileByEmail.get(row.email);
    const name = [row.firstName, row.lastName].filter(Boolean).join(" ");
    const planPerson = people.get(row.email) ?? {
      email: row.email,
      name: profile ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || name || row.email : name || row.email,
      status: profile ? ("matched" as const) : ("new" as const),
      fills: [] as string[],
      rows: 0,
    };
    planPerson.rows += 1;
    if (profile) {
      for (const field of Object.keys(fillsFor(profile, row))) {
        if (!planPerson.fills.includes(FILL_LABELS[field])) planPerson.fills.push(FILL_LABELS[field]);
      }
    }
    people.set(row.email, planPerson);

    rows.push({
      ...base,
      eventLabel: [eventName, row.eventChapter, row.eventDate].join(" · "),
      person: profile ? "matched" : "new",
      event: eventStatus,
      noVolunteerRecord: row.role === "volunteered" && !(profile && volunteerIds.has(profile.id)),
      action: "import",
      reason: "",
    });
  }

  // Already recorded (a matched person at a matched event): shown, and a
  // no-op on write.
  const matchedEventIds = [...new Set([...eventByKey.values()].map((e) => e.id))];
  const matchedUserIds = [...new Set(rows.filter((r) => r.person === "matched" && r.event === "matched").map((r) => profileByEmail.get(r.email)!.id))];
  if (matchedEventIds.length > 0 && matchedUserIds.length > 0) {
    const attended = new Set<string>();
    const served = new Set<string>();
    for (let i = 0; i < matchedUserIds.length; i += 200) {
      const ids = matchedUserIds.slice(i, i + 200);
      const [{ data: rsvps }, { data: signups }] = await Promise.all([
        admin
          .from("rsvps")
          .select("event_id, user_id")
          .in("user_id", ids)
          .in("event_id", matchedEventIds)
          .eq("status", "confirmed")
          .not("checked_in_at", "is", null),
        admin
          .from("volunteer_signups")
          .select("user_id, opportunity:volunteer_opportunities!inner(event_id)")
          .in("user_id", ids)
          .in("opportunity.event_id", matchedEventIds)
          .eq("status", "confirmed")
          .not("checked_in_at", "is", null),
      ]);
      for (const r of rsvps ?? []) attended.add(`${r.user_id}|${r.event_id}`);
      for (const s of (signups ?? []) as unknown as { user_id: string; opportunity: { event_id: number } }[]) {
        served.add(`${s.user_id}|${s.opportunity.event_id}`);
      }
    }
    for (const row of rows) {
      if (row.action !== "import" || row.person !== "matched" || row.event !== "matched") continue;
      const pair = `${profileByEmail.get(row.email)!.id}|${eventByKey.get(eventKey(row.eventChapter, row.eventDate))!.id}`;
      if ((row.role === "attended" ? attended : served).has(pair)) {
        row.action = "already";
        row.reason = row.role === "attended" ? "Already checked in at this event" : "Already recorded as having served at this event";
      }
    }
  }

  return {
    plan: {
      rows,
      people: [...people.values()],
      events: [...events.values()],
      heardAboutDropped: inputs.some((r) => r.heard_about.trim()),
    },
    chapters,
    profileByEmail,
    eventByKey,
  };
}

export type AttendancePreviewResult = { ok: true; plan: AttendancePlan } | { ok: false; error: string };

/** The preview: what the file would do. Writes nothing. */
export async function previewAttendanceImportAction(inputs: AttendanceRowInput[]): Promise<AttendancePreviewResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  if (inputs.length > ATTENDANCE_MAX_ROWS) return { ok: false, error: `At most ${ATTENDANCE_MAX_ROWS} rows per file` };
  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Admin client unavailable" };
  }
  const result = await buildPlan(admin, inputs);
  if ("error" in result) return { ok: false, error: result.error };
  return { ok: true, plan: result.plan };
}

export type AttendanceRowOutcome = {
  rowNumber: number;
  email: string;
  eventLabel: string;
  outcome: "imported" | "already" | "skipped" | "failed";
  message: string;
};

export type AttendanceChunkResult = { ok: true; outcomes: AttendanceRowOutcome[] } | { ok: false; error: string };

/**
 * Writes one chunk (ATTENDANCE_CHUNK_SIZE rows) after the admin confirms.
 * Re-plans the chunk against the database as it is now, so people and
 * events made by an earlier chunk are matched, not made twice.
 */
export async function importAttendanceChunkAction(inputs: AttendanceRowInput[]): Promise<AttendanceChunkResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  if (inputs.length > ATTENDANCE_CHUNK_SIZE) return { ok: false, error: `At most ${ATTENDANCE_CHUNK_SIZE} rows at a time` };
  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Admin client unavailable" };
  }

  const planned = await buildPlan(admin, inputs);
  if ("error" in planned) return { ok: false, error: planned.error };
  const { plan, chapters, profileByEmail, eventByKey } = planned;

  const userIdByEmail = new Map([...profileByEmail.entries()].map(([email, p]) => [email, p.id]));
  const filled = new Set<string>();
  const outcomes: AttendanceRowOutcome[] = [];

  for (const row of plan.rows) {
    const base = { rowNumber: row.rowNumber, email: row.email, eventLabel: row.eventLabel };
    if (row.action === "skip") {
      outcomes.push({ ...base, outcome: "skipped", message: row.reason });
      continue;
    }
    if (row.action === "already") {
      outcomes.push({ ...base, outcome: "already", message: row.reason });
      continue;
    }

    try {
      // The person.
      let userId = userIdByEmail.get(row.email);
      if (!userId) {
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email: row.email,
          email_confirm: true,
          user_metadata: { first_name: row.firstName, last_name: row.lastName },
        });
        if (createError?.code === "email_exists") {
          const existing = await findProfileByEmail(admin, row.email);
          if (!existing) throw new Error("An account has this email but no profile");
          userId = existing.id as string;
        } else if (createError || !created?.user) {
          throw new Error(createError?.message ?? "Couldn't create the account");
        } else {
          userId = created.user.id;
          await assignLeadEventsToNewAccount(admin, userId);
          const fields: Record<string, string> = {};
          if (row.firstName) fields.first_name = row.firstName;
          if (row.lastName) fields.last_name = row.lastName;
          if (row.phone) fields.phone = row.phone;
          if (row.homeChapter) fields.chapter = row.homeChapter;
          if (Object.keys(fields).length > 0) {
            const { error } = await admin.from("profiles").update(fields).eq("id", userId);
            if (error) throw new Error(`The account was made but its details didn't save: ${error.message}`);
          }
          filled.add(row.email);
        }
        userIdByEmail.set(row.email, userId);
      }
      // A matched profile: fill whatever is still blank (each row can add
      // what earlier rows didn't have; nothing is ever overwritten).
      const profile = profileByEmail.get(row.email);
      if (profile && !filled.has(row.email)) {
        const fills = fillsFor(profile, row);
        if (Object.keys(fills).length > 0) {
          const { error } = await admin.from("profiles").update(fills).eq("id", userId);
          if (error) throw new Error(`Profile details didn't save: ${error.message}`);
          profileByEmail.set(row.email, { ...profile, ...fills });
        }
      }

      // The event.
      const key = eventKey(row.eventChapter, row.eventDate);
      let event = eventByKey.get(key);
      if (!event) {
        const chapter = chapters.get(row.eventChapter);
        if (!chapter?.state) throw new Error(`Chapter ${row.eventChapter} has no state set`);
        const startsAt = zonedDateTimeToUtc(row.eventDate, "12:00", chapter.timezone).toISOString();
        const { data: created, error } = await admin
          .from("events")
          .insert({
            name: row.eventName,
            chapter: row.eventChapter,
            event_type: "Other",
            starts_at: startsAt,
            ends_at: null,
            timezone: chapter.timezone,
            waiver_state: chapter.state,
            capacity: null,
            spots_taken: 0,
            is_published: false,
            status: "scheduled",
            imported_at: new Date().toISOString(),
          })
          .select("id, name, chapter, starts_at, timezone, status, imported_at")
          .single();
        if (error || !created) throw new Error(`Couldn't create the event: ${error?.message ?? "unknown error"}`);
        event = created as EventRow;
        eventByKey.set(key, event);
      }

      // The attendance.
      const { data: result, error } = await admin.rpc("import_attendance_row", {
        p_event_id: event.id,
        p_user_id: userId,
        p_role: row.role,
      });
      if (error) throw new Error(error.message);
      const message = (result as string) ?? "";
      if (message === "already") {
        outcomes.push({ ...base, outcome: "already", message: "Already recorded" });
      } else if (message.startsWith("skipped:")) {
        outcomes.push({ ...base, outcome: "skipped", message: message.slice("skipped:".length).trim() });
      } else {
        outcomes.push({ ...base, outcome: "imported", message: message === "created" ? "" : message });
      }
    } catch (err) {
      console.error(`[attendance-import] row ${row.rowNumber} failed:`, err);
      outcomes.push({ ...base, outcome: "failed", message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { ok: true, outcomes };
}
