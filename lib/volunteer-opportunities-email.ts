import type { createAdminClient } from "@/lib/supabase/admin";
import {
  chapterByName,
  currentHomeChapterName,
  isVirtualChapter,
  loadChapters,
  NOT_LOCAL_CHAPTER,
  type Chapter,
} from "@/lib/chapters";
import { cityStateZip } from "@/lib/event-location";
import { formatEventDateRange } from "@/lib/format-date";
import { getSiteUrl } from "@/lib/site-url";
import { PRACTICAL_CHECK_ROLE_KEYS } from "@/lib/practical-checks";
import {
  bulkSendGapMs,
  renderFinishRegistrationEmail,
  renderVolunteerOpportunitiesEmail,
  sendOpportunitiesEmail,
} from "@/lib/email/send";
import type { OpportunitiesEmailEvent, RenderedEmail } from "@/lib/email/templates";
import {
  CATCH_UP_DAYS,
  currentCycleStart,
  dateInZone,
  daysBetween,
  SCHEDULE_ZONE,
  type OpportunitiesSchedule,
} from "@/lib/opportunities-schedule";

/**
 * The every-other-week volunteer opportunities email (see the 2026-09-29
 * "Regions and chapters as data …" schema-changes.sql entry). Runs inside
 * the daily reminders cron and only sends on a send day (Setup → Volunteer
 * opportunities email: on/off, anchor date, weekday).
 *
 * Who gets what — approved volunteers (volunteers.status = 'approved') whose
 * access hasn't been removed, who have an email and haven't turned the
 * email off (profiles.volunteer_opportunities_email):
 *   - registered (registered_at set): open roles at events in the next
 *     OPPORTUNITY_WEEKS weeks, in their region (their home chapter's), or in
 *     every region for "No local chapter". Virtual events go to everyone.
 *     Only roles they could actually take: approved for the role type (or a
 *     role with no type, open to any approved volunteer), an open slot, not
 *     already theirs, and — for an instructor role at an event that requires
 *     health history — a passed practical instruction check. Nothing to show
 *     = nothing sent.
 *   - not registered: the short finish-registration nudge instead.
 * Invited, registered-but-not-approved, inactive and declined volunteers get
 * nothing.
 *
 * Each person gets at most one of the two per cycle. A cycle starts on a
 * send day; volunteers.opportunities_email_cycle records the cycle each
 * person was last handled for (emailed, or checked and had nothing). A run
 * stops itself before the function's time limit and at MAX_SENDS_PER_RUN,
 * and a run on each of the CATCH_UP_DAYS days after a send day carries on
 * with whoever's left — so a cut-off run delays people by a day rather than
 * skipping them. Each send claims the person's row first and puts it back
 * if the email fails (so it's retried the next day); a run killed between
 * the claim and the send loses at most that one email, never sends one
 * twice.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

export const OPPORTUNITY_WEEKS = 6;
const PAGE_SIZE = 1000;
const IN_CHUNK = 200;
/**
 * At most this many emails in one run; the rest go on the next day's run.
 * Sending is through the portal's Google Workspace mailbox (EMAIL_PROVIDER
 * smtp), capped by Google at 2,000 messages per rolling 24 hours for the
 * whole account — shared with every other email the portal sends. Going
 * over locks the account out of sending for up to 24 hours, confirmations
 * and reminders included, so this keeps well clear.
 */
export const MAX_SENDS_PER_RUN = 250;

export async function loadSchedule(client: AdminClient): Promise<OpportunitiesSchedule> {
  const { data, error } = await client
    .from("app_settings")
    .select("opportunities_email_enabled, opportunities_email_anchor, opportunities_email_weekday")
    .maybeSingle();
  if (error) throw new Error(`loading the email schedule: ${error.message}`);
  return {
    enabled: data?.opportunities_email_enabled === true,
    anchor: (data?.opportunities_email_anchor as string | undefined) ?? "2026-10-06",
    weekday: (data?.opportunities_email_weekday as number | undefined) ?? 2,
  };
}

// ---- Who gets what -------------------------------------------------------------------

export type PlannedEmail =
  | { kind: "opportunities"; events: OpportunitiesEmailEvent[]; roleCount: number }
  | { kind: "nudge" }
  | { kind: "none"; reason: string };

export type PlannedRecipient = {
  userId: string;
  email: string;
  name: string;
  /** Their home chapter as stored, and the region the email covers. */
  homeChapter: string;
  coverage: string;
  /** volunteers.opportunities_email_cycle before this run: the send day of
   * the cycle they were last handled for. */
  handledCycle: string | null;
  plan: PlannedEmail;
};

type VolunteerRow = {
  user_id: string;
  status: string;
  registered_at: string | null;
  opportunities_email_cycle: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  chapter: string | null;
  access_removed_at: string | null;
  volunteer_opportunities_email: boolean | null;
};

type OpportunityRow = {
  id: number;
  role: string;
  role_type_id: number | null;
  shift_start: string;
  shift_end: string;
  slots: number;
  slots_taken: number;
  role_type: { key: string } | null;
  event: {
    id: number;
    name: string;
    chapter: string | null;
    starts_at: string;
    ends_at: string | null;
    timezone: string;
    venue_name: string | null;
    city: string | null;
    state: string | null;
    location: string | null;
    requires_health_history: boolean | null;
  } | null;
};

function chunks<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function loadVolunteers(admin: AdminClient, userId?: string): Promise<VolunteerRow[]> {
  const rows: VolunteerRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = admin
      .from("volunteers")
      .select("user_id, status, registered_at, opportunities_email_cycle")
      .order("user_id")
      .range(from, from + PAGE_SIZE - 1);
    // A single person (the dev endpoints) is looked at whatever their status,
    // so the preview can say why they'd get nothing.
    query = userId ? query.eq("user_id", userId) : query.eq("status", "approved");
    const { data, error } = await query;
    if (error) throw new Error(`loading volunteers: ${error.message}`);
    rows.push(...((data ?? []) as VolunteerRow[]));
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadByIds<T>(
  admin: AdminClient,
  ids: string[],
  load: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (const chunk of chunks(ids)) {
    const { data, error } = await load(chunk);
    if (error) throw new Error(`loading ${what}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
  }
  return rows;
}

/** Open roles at published, scheduled events starting in the window. */
async function loadOpenOpportunities(admin: AdminClient, now: Date): Promise<OpportunityRow[]> {
  const windowEnd = new Date(now.getTime() + OPPORTUNITY_WEEKS * 7 * 86_400_000);
  const rows: OpportunityRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("volunteer_opportunities")
      .select(
        "id, role, role_type_id, shift_start, shift_end, slots, slots_taken, role_type:volunteer_role_types(key), event:events!inner(id, name, chapter, starts_at, ends_at, timezone, venue_name, city, state, location, requires_health_history, is_published, status)",
      )
      .is("cancelled_at", null)
      .eq("event.is_published", true)
      .eq("event.status", "scheduled")
      .gt("event.starts_at", now.toISOString())
      .lt("event.starts_at", windowEnd.toISOString())
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`loading volunteer roles: ${error.message}`);
    rows.push(...((data ?? []) as unknown as OpportunityRow[]));
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return rows.filter((o) => o.event && o.slots_taken < o.slots);
}

function venueLabel(event: NonNullable<OpportunityRow["event"]>): string {
  if (isVirtualChapter(event.chapter)) return "Online";
  const place = [event.venue_name?.trim(), cityStateZip(event.city, event.state, null)].filter(Boolean).join(", ");
  return place || event.location?.trim() || "Location to be confirmed";
}

function chapterLabel(chapter: string | null): string {
  if (!chapter) return "No chapter";
  return isVirtualChapter(chapter) ? "Virtual" : `${chapter} chapter`;
}

/** The region an event chapter belongs to, or null (Virtual, or unknown). */
function regionOf(chapters: Chapter[], chapter: string | null | undefined): number | null {
  return chapterByName(chapters, currentHomeChapterName(chapter))?.region_id ?? null;
}

/**
 * What each approved volunteer (or just `userId`) would be sent at `now`.
 * Reads with the service role; changes nothing.
 */
export async function planOpportunitiesEmails(
  admin: AdminClient,
  options: { now: Date; userId?: string },
): Promise<PlannedRecipient[]> {
  const { now, userId } = options;
  const volunteers = await loadVolunteers(admin, userId);
  const ids = volunteers.map((v) => v.user_id);
  if (ids.length === 0) return [];

  const [profiles, chapters, regionsResult, opportunities] = await Promise.all([
    loadByIds<ProfileRow>(
      admin,
      ids,
      (chunk) =>
        admin
          .from("profiles")
          .select("id, email, first_name, last_name, chapter, access_removed_at, volunteer_opportunities_email")
          .in("id", chunk),
      "profiles",
    ),
    loadChapters(admin),
    admin.from("regions").select("id, name"),
    loadOpenOpportunities(admin, now),
  ]);
  const regionName = new Map(((regionsResult.data ?? []) as { id: number; name: string }[]).map((r) => [r.id, r.name]));
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  // Only registered volunteers get opportunities, so only they need the rest.
  const registeredIds = volunteers.filter((v) => v.registered_at).map((v) => v.user_id);
  const opportunityIds = opportunities.map((o) => o.id);
  const [approvals, checks, signups] = await Promise.all([
    loadByIds<{ volunteer_id: string; role_type_id: number }>(
      admin,
      registeredIds,
      (chunk) =>
        admin
          .from("volunteer_role_approvals")
          .select("volunteer_id, role_type_id")
          .in("volunteer_id", chunk)
          .is("revoked_at", null),
      "role approvals",
    ),
    loadByIds<{ user_id: string; outcome: string; checked_on: string; recorded_at: string }>(
      admin,
      registeredIds,
      (chunk) =>
        admin
          .from("practical_instruction_checks")
          .select("user_id, outcome, checked_on, recorded_at")
          .in("user_id", chunk),
      "practical checks",
    ),
    opportunityIds.length > 0
      ? loadByIds<{ user_id: string; opportunity_id: number }>(
          admin,
          opportunityIds.map(String),
          (chunk) =>
            admin
              .from("volunteer_signups")
              .select("user_id, opportunity_id")
              .eq("status", "confirmed")
              .in("opportunity_id", chunk.map(Number)),
          "signups",
        )
      : Promise.resolve([]),
  ]);

  const approvedTypes = new Map<string, Set<number>>();
  for (const a of approvals) {
    const set = approvedTypes.get(a.volunteer_id) ?? new Set<number>();
    set.add(a.role_type_id);
    approvedTypes.set(a.volunteer_id, set);
  }
  // The latest check is the one that counts (newest date, then newest entry).
  const latestCheck = new Map<string, { outcome: string; checked_on: string; recorded_at: string }>();
  for (const c of checks) {
    const current = latestCheck.get(c.user_id);
    if (
      !current ||
      c.checked_on > current.checked_on ||
      (c.checked_on === current.checked_on && c.recorded_at > current.recorded_at)
    ) {
      latestCheck.set(c.user_id, c);
    }
  }
  const signedUp = new Set(signups.map((s) => `${s.user_id}:${s.opportunity_id}`));

  const site = getSiteUrl();
  const sorted = [...opportunities].sort(
    (a, b) => a.event!.starts_at.localeCompare(b.event!.starts_at) || a.shift_start.localeCompare(b.shift_start),
  );

  return volunteers.map((v): PlannedRecipient => {
    const profile = profileById.get(v.user_id);
    const homeChapter = profile?.chapter ?? "";
    const base = {
      userId: v.user_id,
      email: profile?.email?.trim() ?? "",
      name: [profile?.first_name, profile?.last_name].filter(Boolean).join(" "),
      homeChapter,
      handledCycle: v.opportunities_email_cycle,
    };
    const none = (reason: string, coverage = ""): PlannedRecipient => ({
      ...base,
      coverage,
      plan: { kind: "none", reason },
    });

    if (v.status !== "approved") return none(`status is ${v.status}, not approved`);
    if (!profile) return none("no profile");
    if (profile.access_removed_at) return none("access removed");
    if (!base.email) return none("no email on their profile");
    if (profile.volunteer_opportunities_email === false) return none("turned the email off");
    if (!v.registered_at) return { ...base, coverage: "", plan: { kind: "nudge" } };

    // Their region, or every region for "No local chapter". Virtual events
    // go to everyone.
    const home = currentHomeChapterName(homeChapter);
    const everywhere = home === NOT_LOCAL_CHAPTER;
    const homeRegion = everywhere ? null : regionOf(chapters, home);
    if (!everywhere && homeRegion == null) {
      return none(homeChapter ? `home chapter "${homeChapter}" isn't a chapter` : "no home chapter");
    }
    const coverage = everywhere ? "every region" : (regionName.get(homeRegion!) ?? "their region");

    const types = approvedTypes.get(v.user_id) ?? new Set<number>();
    const passedCheck = latestCheck.get(v.user_id)?.outcome === "passed";
    const events = new Map<number, OpportunitiesEmailEvent>();
    let roleCount = 0;
    for (const o of sorted) {
      const event = o.event!;
      if (!everywhere && !isVirtualChapter(event.chapter) && regionOf(chapters, event.chapter) !== homeRegion) continue;
      if (o.role_type_id != null && !types.has(o.role_type_id)) continue;
      if (signedUp.has(`${v.user_id}:${o.id}`)) continue;
      // The database refuses these without a passed check
      // (volunteer_signups_practical_check_guard), so they're never offered.
      const needsCheck =
        event.requires_health_history === true && PRACTICAL_CHECK_ROLE_KEYS.includes(o.role_type?.key ?? "");
      if (needsCheck && !passedCheck) continue;

      let entry = events.get(event.id);
      if (!entry) {
        entry = {
          name: event.name,
          dateRange: formatEventDateRange(event.starts_at, event.ends_at, event.timezone),
          chapterLabel: chapterLabel(event.chapter),
          venue: venueLabel(event),
          url: `${site}/protected/events/${event.id}/rsvp`,
          roles: [],
        };
        events.set(event.id, entry);
      }
      entry.roles.push({
        role: o.role,
        shiftRange: formatEventDateRange(o.shift_start, o.shift_end, event.timezone),
        openSlots: o.slots - o.slots_taken,
      });
      roleCount++;
    }
    if (roleCount === 0) return none("nothing to show", coverage);
    return { ...base, coverage, plan: { kind: "opportunities", events: [...events.values()], roleCount } };
  });
}

// ---- Rendering and sending ---------------------------------------------------------------

/** Each person's unsubscribe token, created the first time it's needed. */
async function unsubscribeTokens(admin: AdminClient, userIds: string[]): Promise<Map<string, string>> {
  const tokens = new Map<string, string>();
  if (userIds.length === 0) return tokens;
  for (const chunk of chunks(userIds)) {
    const { error } = await admin
      .from("email_preference_tokens")
      .upsert(chunk.map((user_id) => ({ user_id })), { onConflict: "user_id", ignoreDuplicates: true });
    if (error) throw new Error(`creating unsubscribe tokens: ${error.message}`);
    const { data, error: readError } = await admin
      .from("email_preference_tokens")
      .select("user_id, token")
      .in("user_id", chunk);
    if (readError) throw new Error(`reading unsubscribe tokens: ${readError.message}`);
    for (const row of (data ?? []) as { user_id: string; token: string }[]) tokens.set(row.user_id, row.token);
  }
  return tokens;
}

/** The email a planned recipient gets, or null for none. */
export function renderPlannedEmail(recipient: PlannedRecipient, token: string): RenderedEmail | null {
  const firstName = recipient.name.split(" ")[0] || null;
  if (recipient.plan.kind === "opportunities") {
    return renderVolunteerOpportunitiesEmail({
      recipientName: firstName,
      events: recipient.plan.events,
      weeks: OPPORTUNITY_WEEKS,
      token,
    });
  }
  if (recipient.plan.kind === "nudge") return renderFinishRegistrationEmail({ recipientName: firstName, token });
  return null;
}

/** For the dev preview: the email with a placeholder token (none is
 * created — a preview changes nothing). */
export function previewPlannedEmail(recipient: PlannedRecipient): RenderedEmail | null {
  return renderPlannedEmail(recipient, "preview-token");
}

export type OpportunitiesRunSummary = {
  today: string;
  /** The send day of the cycle this run worked on. */
  cycle: string | null;
  /** False when the email is off, or it's past a send day's catch-up days —
   * nothing else was looked at. */
  ran: boolean;
  why?: string;
  opportunities: string[];
  nudges: string[];
  /** Already handled this cycle, by an earlier run. */
  alreadyHandled: number;
  failed: string[];
  /** Not reached this run (time or MAX_SENDS_PER_RUN) — the next day's run
   * carries on with them, within the catch-up days. */
  leftForNextRun: number;
  /** Approved volunteers who got nothing, and why. */
  nothing: { who: string; reason: string }[];
  dry: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The daily run: with the email turned on, on a send day or one of the
 * CATCH_UP_DAYS after it, sends every approved volunteer not yet handled
 * this cycle their email (or records that they get nothing). `now` is the
 * moment to act as (the reminders cron's dev ?today= passes a pretend
 * date). `deadline` (epoch ms) is when to stop starting new sends, so the
 * run ends before the function is cut off. `dry` plans without sending,
 * claiming, recording or creating tokens.
 *
 * `userId` + `ignoreSchedule` is the dev "send it to one person now" path:
 * it skips the schedule and the cycle record, but not the rules about who
 * gets what (the opt-out included). `redirectTo` (dev only) sends their
 * email to that address instead of theirs.
 */
export async function runOpportunitiesEmail(
  admin: AdminClient,
  options: {
    now: Date;
    dry?: boolean;
    userId?: string;
    ignoreSchedule?: boolean;
    redirectTo?: string;
    deadline?: number;
  },
): Promise<OpportunitiesRunSummary> {
  const { now, dry = false, userId, ignoreSchedule = false, redirectTo, deadline = Infinity } = options;
  const today = dateInZone(now, SCHEDULE_ZONE);
  const summary: OpportunitiesRunSummary = {
    today,
    cycle: null,
    ran: false,
    opportunities: [],
    nudges: [],
    alreadyHandled: 0,
    failed: [],
    leftForNextRun: 0,
    nothing: [],
    dry,
  };

  let cycle: string | null = null;
  if (!ignoreSchedule) {
    const schedule = await loadSchedule(admin);
    if (!schedule.enabled) return { ...summary, why: "turned off in Setup" };
    cycle = currentCycleStart(schedule, today);
    if (daysBetween(cycle, today) > CATCH_UP_DAYS) {
      return { ...summary, cycle, why: `not a send day (last one ${cycle}, its catch-up days are over)` };
    }
  }
  summary.cycle = cycle;
  summary.ran = true;

  // Cycle dates are YYYY-MM-DD, so they compare as strings.
  const handled = (r: PlannedRecipient) => cycle != null && r.handledCycle != null && r.handledCycle >= cycle;
  const recipients = (await planOpportunitiesEmails(admin, { now, userId })).filter((r) => {
    if (!handled(r)) return true;
    summary.alreadyHandled++;
    return false;
  });
  const sending = recipients.filter((r) => r.plan.kind !== "none");
  const getsNothing = recipients.filter((r) => r.plan.kind === "none");
  for (const r of getsNothing) {
    if (r.plan.kind === "none") summary.nothing.push({ who: r.email || r.userId, reason: r.plan.reason });
  }
  if (dry) {
    for (const r of sending) (r.plan.kind === "nudge" ? summary.nudges : summary.opportunities).push(r.email);
    return summary;
  }

  // Nothing for them this cycle: recorded, so a catch-up run later in the
  // cycle doesn't email them if something turns up in between.
  const unhandled = `opportunities_email_cycle.is.null,opportunities_email_cycle.lt.${cycle}`;
  if (cycle) {
    for (const ids of chunks(getsNothing.map((r) => r.userId))) {
      const { error } = await admin
        .from("volunteers")
        .update({ opportunities_email_cycle: cycle })
        .in("user_id", ids)
        .or(unhandled);
      if (error) summary.failed.push(`recording who gets nothing: ${error.message}`);
    }
  }

  const tokens = await unsubscribeTokens(
    admin,
    sending.map((r) => r.userId),
  );
  const gap = bulkSendGapMs();
  let sent = 0;
  for (const [index, r] of sending.entries()) {
    if (sent >= MAX_SENDS_PER_RUN || Date.now() + gap >= deadline) {
      summary.leftForNextRun = sending.length - index;
      break;
    }
    if (cycle) {
      // Claim first so an overlapping run can't send twice; undone on failure.
      const { data: claimed, error: claimError } = await admin
        .from("volunteers")
        .update({ opportunities_email_cycle: cycle })
        .eq("user_id", r.userId)
        .or(unhandled)
        .select("user_id");
      if (claimError) {
        summary.failed.push(`${r.email}: ${claimError.message}`);
        continue;
      }
      if (!claimed?.length) {
        summary.alreadyHandled++;
        continue;
      }
    }

    const token = tokens.get(r.userId);
    const rendered = token ? renderPlannedEmail(r, token) : null;
    try {
      if (!rendered || !token) throw new Error("no unsubscribe token");
      if (sent > 0) await sleep(gap);
      await sendOpportunitiesEmail({ toEmail: redirectTo || r.email, token, rendered });
      sent++;
      (r.plan.kind === "nudge" ? summary.nudges : summary.opportunities).push(r.email);
    } catch (err) {
      summary.failed.push(`${r.email}: ${err instanceof Error ? err.message : String(err)}`);
      // Put the claim back, so the next day's run (within the catch-up
      // days) tries them again.
      if (cycle) {
        await admin.from("volunteers").update({ opportunities_email_cycle: r.handledCycle }).eq("user_id", r.userId);
      }
    }
  }
  return summary;
}
