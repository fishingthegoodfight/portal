import type { createClient } from "@/lib/supabase/server";
import type { VolunteerRoleInput } from "@/lib/actions/admin-create-event";
import {
  sendVolunteerEventRestoredEmail,
  sendVolunteerRoleCancelledEmail,
  sendVolunteerShiftEventCancelledEmail,
  type VolunteerShiftEmailContext,
} from "@/lib/email/send";
import type { EventChangeDiffEntry } from "@/lib/email/templates";
import { formatEventDateRange } from "@/lib/format-date";
import { toZonedDateTimeInputs, zonedDateTimeToUtc } from "@/lib/timezone";

/**
 * Volunteer roles (volunteer_opportunities) on an existing event: loading
 * them with their signup counts, turning the edit form's roles into a list
 * of writes, and applying that same edit to the matching roles on other
 * occurrences of a series. Everything is planned (and validated) before any
 * write, so a problem on any occurrence stops the whole save.
 *
 * Guards: "Number needed" never drops below the confirmed signups, and a role
 * with confirmed signups is never deleted — it's cancelled instead
 * (admin_cancel_volunteer_opportunity), which cancels those signups and
 * emails the volunteers. See the 2026-09-22 "Editable volunteer roles"
 * schema-changes.sql entry.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** A role row in the edit form. `id` is null for a role added in this edit;
 * `removal` marks an existing role for deletion (only allowed with no
 * signups) or cancellation. */
export type EditableVolunteerRole = VolunteerRoleInput & {
  id: number | null;
  removal: "delete" | "cancel" | null;
};

export type ExistingRole = {
  id: number;
  event_id: number;
  role: string;
  description: string | null;
  what_to_bring: string | null;
  role_type_id: number | null;
  shift_start: string;
  shift_end: string;
  slots: number;
  /** Confirmed volunteer_signups right now. */
  confirmed: number;
};

/** The event fields a role write needs: its date/zone for shift times, and
 * what a cancellation email says. */
export type RoleEventContext = {
  id: number;
  name: string;
  starts_at: string;
  timezone: string;
  location: string | null;
  virtual_link: string | null;
  virtual_access_notes: string | null;
  lead_email: string | null;
};

export type RoleOp =
  | { kind: "insert"; eventId: number; row: Record<string, unknown> }
  | { kind: "update"; eventId: number; id: number; patch: Record<string, unknown> }
  | { kind: "delete"; eventId: number; id: number; title: string }
  | { kind: "cancel"; eventId: number; id: number; title: string };

export type RolePlan = { ops: RoleOp[]; errors: string[]; diff: EventChangeDiffEntry[] };

/** Active (not cancelled) roles at these events, with confirmed signup counts. */
export async function loadActiveRoles(
  supabase: SupabaseServerClient,
  eventIds: number[],
): Promise<ExistingRole[]> {
  if (eventIds.length === 0) return [];
  const { data: rows } = await supabase
    .from("volunteer_opportunities")
    .select("id, event_id, role, description, what_to_bring, role_type_id, shift_start, shift_end, slots")
    .in("event_id", eventIds)
    .is("cancelled_at", null)
    .order("shift_start", { ascending: true })
    .order("id", { ascending: true });
  const roles = (rows ?? []) as Omit<ExistingRole, "confirmed">[];
  if (roles.length === 0) return [];

  const { data: signups } = await supabase
    .from("volunteer_signups")
    .select("opportunity_id")
    .in(
      "opportunity_id",
      roles.map((r) => r.id),
    )
    .eq("status", "confirmed");
  const counts = new Map<number, number>();
  for (const s of signups ?? []) {
    const id = s.opportunity_id as number;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return roles.map((r) => ({ ...r, confirmed: counts.get(r.id) ?? 0 }));
}

/** An existing role as the edit form shows it — shift times as HH:MM in the
 * event's own zone. */
export function toEditableRole(role: ExistingRole, timeZone: string): EditableVolunteerRole {
  return {
    id: role.id,
    removal: null,
    title: role.role,
    description: role.description ?? "",
    whatToBring: role.what_to_bring ?? "",
    numberNeeded: String(role.slots),
    roleTypeId: role.role_type_id != null ? String(role.role_type_id) : "",
    shiftStart: toZonedDateTimeInputs(new Date(role.shift_start), timeZone).time,
    shiftEnd: toZonedDateTimeInputs(new Date(role.shift_end), timeZone).time,
  };
}

/** Same rules as the create wizard (createEventAction). */
function roleProblem(role: VolunteerRoleInput): string | null {
  const title = role.title.trim();
  if (!title) return "Every volunteer role needs a title";
  const needed = Number(role.numberNeeded.trim());
  if (!Number.isInteger(needed) || needed < 1) {
    return `"${title}" needs a number needed of at least 1`;
  }
  if (!role.shiftStart || !role.shiftEnd) return `"${title}" needs a shift start and end time`;
  if (role.shiftEnd <= role.shiftStart) return `"${title}"'s shift end must be after its start`;
  return null;
}

function roleSummary(
  role: { role: string; slots: number; shift_start: string; shift_end: string },
  timeZone: string,
): string {
  return `${role.role} (${role.slots} needed, ${formatEventDateRange(role.shift_start, role.shift_end, timeZone)})`;
}

const eventDate = (event: RoleEventContext) =>
  toZonedDateTimeInputs(new Date(event.starts_at), event.timezone).date;

const shiftInstant = (date: string, time: string, timeZone: string) =>
  zonedDateTimeToUtc(date, time, timeZone).toISOString();

function insertRow(role: VolunteerRoleInput, event: RoleEventContext): Record<string, unknown> {
  const date = eventDate(event);
  return {
    event_id: event.id,
    role: role.title.trim(),
    description: role.description.trim() || null,
    what_to_bring: role.whatToBring.trim() || null,
    role_type_id: role.roleTypeId ? Number(role.roleTypeId) : null,
    slots: Number(role.numberNeeded.trim()),
    shift_start: shiftInstant(date, role.shiftStart, event.timezone),
    shift_end: shiftInstant(date, role.shiftEnd, event.timezone),
  };
}

/** The columns of `role` that differ from `existing`, with shift times
 * pinned to `event`'s date — so moving the event's date moves its shifts. */
function changedColumns(
  role: VolunteerRoleInput,
  existing: ExistingRole,
  event: RoleEventContext,
): Record<string, unknown> {
  const next = insertRow(role, event);
  const patch: Record<string, unknown> = {};
  for (const key of ["role", "description", "what_to_bring", "role_type_id", "slots"] as const) {
    if (next[key] !== existing[key]) patch[key] = next[key];
  }
  for (const key of ["shift_start", "shift_end"] as const) {
    if (new Date(next[key] as string).getTime() !== new Date(existing[key]).getTime()) {
      patch[key] = next[key];
    }
  }
  return patch;
}

/**
 * The edited event's own roles: what the form submitted vs what's there now.
 * `event` is the event as it will be after the save (its new date/zone).
 */
export function planEventRoles(
  inputs: EditableVolunteerRole[],
  existing: ExistingRole[],
  event: RoleEventContext,
  /** volunteer_role_types id -> name, for the admin notification diff. */
  roleTypeNames: Map<number, string>,
): RolePlan {
  const roleTypeLabel = (id: number | null) =>
    id == null ? "Custom / other" : (roleTypeNames.get(id) ?? `Role type ${id}`);
  const plan: RolePlan = { ops: [], errors: [], diff: [] };
  const byId = new Map(existing.map((r) => [r.id, r]));
  const tz = event.timezone;

  for (const input of inputs) {
    if (input.id == null) {
      if (input.removal) continue;
      const problem = roleProblem(input);
      if (problem) {
        plan.errors.push(problem);
        continue;
      }
      const row = insertRow(input, event);
      plan.ops.push({ kind: "insert", eventId: event.id, row });
      plan.diff.push({
        label: "Volunteer role added",
        before: "",
        after: roleSummary(row as Parameters<typeof roleSummary>[0], tz),
      });
      continue;
    }

    const current = byId.get(input.id);
    if (!current) {
      plan.errors.push(
        `"${input.title.trim() || "A volunteer role"}" was changed by someone else since you opened this form — reload and try again`,
      );
      continue;
    }

    if (input.removal === "delete") {
      if (current.confirmed > 0) {
        plan.errors.push(
          `"${current.role}" has ${current.confirmed} signed up, so it can't be deleted — cancel it instead`,
        );
        continue;
      }
      plan.ops.push({ kind: "delete", eventId: event.id, id: current.id, title: current.role });
      plan.diff.push({ label: "Volunteer role deleted", before: roleSummary(current, tz), after: "" });
      continue;
    }

    if (input.removal === "cancel") {
      plan.ops.push({ kind: "cancel", eventId: event.id, id: current.id, title: current.role });
      plan.diff.push({
        label: "Volunteer role cancelled",
        before: roleSummary(current, tz),
        after:
          current.confirmed > 0
            ? `Cancelled — ${current.confirmed} signup${current.confirmed === 1 ? "" : "s"} cancelled and emailed`
            : "Cancelled",
      });
      continue;
    }

    const problem = roleProblem(input);
    if (problem) {
      plan.errors.push(problem);
      continue;
    }
    const patch = changedColumns(input, current, event);
    if (patch.slots != null && (patch.slots as number) < current.confirmed) {
      plan.errors.push(
        `"${current.role}" has ${current.confirmed} signed up, so number needed can't go below ${current.confirmed}`,
      );
      continue;
    }
    if (Object.keys(patch).length > 0) {
      plan.ops.push({ kind: "update", eventId: event.id, id: current.id, patch });
      const after = { ...current, ...patch } as ExistingRole;
      const push = (label: string, before: string, afterValue: string) => {
        if (before !== afterValue) plan.diff.push({ label, before, after: afterValue });
      };
      push("Volunteer role changed", roleSummary(current, tz), roleSummary(after, tz));
      push(`Volunteer role "${after.role}" description`, current.description ?? "", after.description ?? "");
      push(`Volunteer role "${after.role}" what to bring`, current.what_to_bring ?? "", after.what_to_bring ?? "");
      if (current.role_type_id !== after.role_type_id) {
        plan.diff.push({
          label: `Volunteer role "${after.role}" role type`,
          before: roleTypeLabel(current.role_type_id),
          after: roleTypeLabel(after.role_type_id),
        });
      }
    }
  }

  return plan;
}

const roleKey = (r: { role: string; role_type_id: number | null }) =>
  `${r.role_type_id ?? ""}|${r.role.trim().toLowerCase()}`;

/** Pairs each of the edited event's roles with the same role on another
 * occurrence: same title and role type, and among duplicates, the same
 * position. Roles created together for a series always line up this way. */
function matchRoles(anchor: ExistingRole[], sibling: ExistingRole[]): Map<number, ExistingRole> {
  const pool = new Map<string, ExistingRole[]>();
  for (const r of sibling) {
    const key = roleKey(r);
    pool.set(key, [...(pool.get(key) ?? []), r]);
  }
  const matches = new Map<number, ExistingRole>();
  for (const r of anchor) {
    const candidates = pool.get(roleKey(r));
    const match = candidates?.shift();
    if (match) matches.set(r.id, match);
  }
  return matches;
}

/**
 * Applies the same role edit to another occurrence of the series: only what
 * the admin actually changed on the edited event carries over (a role
 * individually adjusted on this occurrence keeps its other differences),
 * shift times land on this occurrence's own date, and the same guards apply
 * against this occurrence's own signups.
 */
export function planSiblingRoles(
  inputs: EditableVolunteerRole[],
  anchorExisting: ExistingRole[],
  anchorTimeZone: string,
  siblingExisting: ExistingRole[],
  sibling: RoleEventContext,
): RolePlan {
  const plan: RolePlan = { ops: [], errors: [], diff: [] };
  const anchorById = new Map(anchorExisting.map((r) => [r.id, r]));
  const matches = matchRoles(anchorExisting, siblingExisting);
  const tz = sibling.timezone;
  const onDate = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: tz,
  }).format(new Date(sibling.starts_at));

  for (const input of inputs) {
    if (input.id == null) {
      if (!input.removal && !roleProblem(input)) {
        plan.ops.push({ kind: "insert", eventId: sibling.id, row: insertRow(input, sibling) });
      }
      continue;
    }

    const anchorRole = anchorById.get(input.id);
    const match = anchorRole ? matches.get(anchorRole.id) : undefined;
    if (!anchorRole || !match) continue;

    if (input.removal === "delete") {
      if (match.confirmed > 0) {
        plan.errors.push(
          `"${match.role}" on ${onDate} has ${match.confirmed} signed up, so it can't be deleted there — cancel the role instead`,
        );
        continue;
      }
      plan.ops.push({ kind: "delete", eventId: sibling.id, id: match.id, title: match.role });
      continue;
    }
    if (input.removal === "cancel") {
      plan.ops.push({ kind: "cancel", eventId: sibling.id, id: match.id, title: match.role });
      continue;
    }
    if (roleProblem(input)) continue; // already reported for the edited event

    const anchorForm = toEditableRole(anchorRole, anchorTimeZone);
    const matchForm = toEditableRole(match, tz);
    const merged: VolunteerRoleInput = { ...matchForm };
    for (const field of [
      "title",
      "description",
      "whatToBring",
      "numberNeeded",
      "roleTypeId",
      "shiftStart",
      "shiftEnd",
    ] as const) {
      if (input[field].trim() !== anchorForm[field].trim()) merged[field] = input[field];
    }
    if (merged.shiftEnd <= merged.shiftStart) {
      plan.errors.push(`"${match.role}" on ${onDate}: shift end would be before its start`);
      continue;
    }
    const patch = changedColumns(merged, match, sibling);
    if (patch.slots != null && (patch.slots as number) < match.confirmed) {
      plan.errors.push(
        `"${match.role}" on ${onDate} has ${match.confirmed} signed up, so number needed can't go below ${match.confirmed} there`,
      );
      continue;
    }
    if (Object.keys(patch).length > 0) {
      plan.ops.push({ kind: "update", eventId: sibling.id, id: match.id, patch });
    }
  }

  return plan;
}

export type RoleOpsResult = { error: string | null; cancelledSignups: number };

/** Runs a plan's writes in order. Emails for cancelled roles go out after
 * the cancel succeeds; a failed email is logged, never fatal. */
export async function executeRoleOps(
  supabase: SupabaseServerClient,
  ops: RoleOp[],
  eventsById: Map<number, RoleEventContext>,
): Promise<RoleOpsResult> {
  let cancelledSignups = 0;
  for (const op of ops) {
    if (op.kind === "insert") {
      const { error } = await supabase.from("volunteer_opportunities").insert(op.row);
      if (error) return { error: `Adding a volunteer role failed: ${error.message}`, cancelledSignups };
    } else if (op.kind === "update") {
      let query = supabase.from("volunteer_opportunities").update(op.patch).eq("id", op.id);
      // Atomic floor: a signup that lands between planning and this write
      // makes the update match nothing instead of overbooking the role.
      if (op.patch.slots != null) query = query.lte("slots_taken", op.patch.slots as number);
      const { data, error } = await query.select("id");
      if (error) return { error: `Updating a volunteer role failed: ${error.message}`, cancelledSignups };
      if (!data || data.length === 0) {
        return {
          error: "Someone signed up for a volunteer role while you were editing it — reload and try again",
          cancelledSignups,
        };
      }
    } else if (op.kind === "delete") {
      const { data, error } = await supabase.rpc("admin_delete_volunteer_opportunity", {
        p_opportunity_id: op.id,
      });
      if (error) return { error: `Deleting "${op.title}" failed: ${error.message}`, cancelledSignups };
      if (data === "has_signups") {
        return {
          error: `Someone signed up for "${op.title}" while you were editing — cancel the role instead`,
          cancelledSignups,
        };
      }
    } else {
      const { data: opportunity } = await supabase
        .from("volunteer_opportunities")
        .select(SHIFT_COLUMNS)
        .eq("id", op.id)
        .maybeSingle();
      const { data: cancelled, error } = await supabase.rpc("admin_cancel_volunteer_opportunity", {
        p_opportunity_id: op.id,
      });
      if (error) return { error: `Cancelling "${op.title}" failed: ${error.message}`, cancelledSignups };
      const userIds = ((cancelled ?? []) as { user_id: string }[]).map((r) => r.user_id);
      cancelledSignups += userIds.length;
      const event = eventsById.get(op.eventId);
      if (userIds.length > 0 && opportunity && event) {
        await emailShiftVolunteers(supabase, userIds, opportunity, event, sendVolunteerRoleCancelledEmail);
      }
    }
  }
  return { error: null, cancelledSignups };
}

type ShiftOpportunity = {
  id: number;
  role: string;
  description: string | null;
  what_to_bring: string | null;
  shift_start: string;
  shift_end: string;
};

const SHIFT_COLUMNS = "id, role, description, what_to_bring, shift_start, shift_end";

/** Emails each of these users about one shift with `send`. A failed email
 * is logged and skipped, never fatal. */
async function emailShiftVolunteers(
  supabase: SupabaseServerClient,
  userIds: string[],
  opportunity: ShiftOpportunity,
  event: RoleEventContext,
  send: (args: { toEmail: string; ctx: VolunteerShiftEmailContext }) => Promise<void>,
) {
  if (userIds.length === 0) return;
  const { data: profiles } = await supabase.from("profiles").select("email").in("id", userIds);
  for (const profile of profiles ?? []) {
    const toEmail = profile.email as string | null;
    if (!toEmail) continue;
    try {
      await send({
        toEmail,
        ctx: {
          opportunityId: opportunity.id,
          role: opportunity.role,
          description: opportunity.description,
          whatToBring: opportunity.what_to_bring,
          shiftStart: opportunity.shift_start,
          shiftEnd: opportunity.shift_end,
          eventId: event.id,
          eventName: event.name,
          timezone: event.timezone,
          location: event.location,
          virtualLink: event.virtual_link,
          virtualAccessNotes: event.virtual_access_notes,
          leadEmail: event.lead_email,
        },
      });
    } catch (err) {
      console.error(`[event-roles] role ${opportunity.id}: email to ${toEmail} failed:`, err);
    }
  }
}

/** userIds grouped by the opportunity they were signed up for. */
function byOpportunity(rows: { user_id: string; opportunity_id: number }[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const r of rows) map.set(r.opportunity_id, [...(map.get(r.opportunity_id) ?? []), r.user_id]);
  return map;
}

/**
 * The volunteer side of cancelling an event (cancelEventAction): every
 * confirmed signup on its active roles -> 'cancelled', stamped with the
 * event's own `cancelledAt` (so a later restore can tell exactly which
 * signups went with the event — see volunteersCancelledWithEvent), slots
 * freed, and each volunteer emailed the reason with a METHOD:CANCEL .ics.
 * The roles themselves stay open, so a restored event can be signed up for
 * again. Call only after the event row is cancelled — try_claim_volunteer_slot
 * refuses a cancelled event, so no new signup can land in between.
 */
export async function cancelEventVolunteerSignups(
  supabase: SupabaseServerClient,
  event: RoleEventContext,
  reason: string,
  cancelledAt: string,
): Promise<{ cancelledCount: number; error: string | null }> {
  const { data: opportunityRows } = await supabase
    .from("volunteer_opportunities")
    .select(SHIFT_COLUMNS)
    .eq("event_id", event.id)
    .is("cancelled_at", null);
  const opportunities = (opportunityRows ?? []) as ShiftOpportunity[];
  if (opportunities.length === 0) return { cancelledCount: 0, error: null };
  const ids = opportunities.map((o) => o.id);

  const { data: cancelled, error } = await supabase
    .from("volunteer_signups")
    .update({ status: "cancelled", cancelled_at: cancelledAt })
    .in("opportunity_id", ids)
    .eq("status", "confirmed")
    .select("user_id, opportunity_id");
  if (error) return { cancelledCount: 0, error: error.message };

  const { error: slotsError } = await supabase
    .from("volunteer_opportunities")
    .update({ slots_taken: 0 })
    .in("id", ids);
  if (slotsError) {
    console.error(`[event-roles] event ${event.id}: resetting slots_taken failed:`, slotsError);
  }

  const rows = (cancelled ?? []) as { user_id: string; opportunity_id: number }[];
  for (const [opportunityId, userIds] of byOpportunity(rows)) {
    const opportunity = opportunities.find((o) => o.id === opportunityId);
    if (!opportunity) continue;
    await emailShiftVolunteers(supabase, userIds, opportunity, event, ({ toEmail, ctx }) =>
      sendVolunteerShiftEventCancelledEmail({ toEmail, ctx, reason }),
    );
  }
  return { cancelledCount: rows.length, error: null };
}

/** Signups cancelled by the event's cancellation (not by the volunteer or by
 * an earlier role cancel): cancelled at or after the event's own
 * cancelled_at. Nothing else can cancel a signup on a cancelled event —
 * there are no confirmed ones left. */
async function signupsCancelledWithEvent(
  supabase: SupabaseServerClient,
  eventId: number,
  eventCancelledAt: string | null,
): Promise<{ opportunities: ShiftOpportunity[]; rows: { user_id: string; opportunity_id: number }[] }> {
  if (!eventCancelledAt) return { opportunities: [], rows: [] };
  const { data: opportunityRows } = await supabase
    .from("volunteer_opportunities")
    .select(SHIFT_COLUMNS)
    .eq("event_id", eventId)
    .is("cancelled_at", null);
  const opportunities = (opportunityRows ?? []) as ShiftOpportunity[];
  if (opportunities.length === 0) return { opportunities, rows: [] };
  const { data } = await supabase
    .from("volunteer_signups")
    .select("user_id, opportunity_id")
    .in(
      "opportunity_id",
      opportunities.map((o) => o.id),
    )
    .eq("status", "cancelled")
    .gte("cancelled_at", eventCancelledAt);
  return { opportunities, rows: (data ?? []) as { user_id: string; opportunity_id: number }[] };
}

/** How many volunteer signups a cancelled event took with it — shown in the
 * restore dialog, since restoring doesn't bring them back. */
export async function countSignupsCancelledWithEvent(
  supabase: SupabaseServerClient,
  eventId: number,
  eventCancelledAt: string | null,
): Promise<number> {
  return (await signupsCancelledWithEvent(supabase, eventId, eventCancelledAt)).rows.length;
}

/** Restoring an event: tell the volunteers whose shifts went with the
 * cancellation that it's back on and they can sign up again. Their signups
 * stay cancelled. Returns how many were emailed-to (by signup). */
export async function emailVolunteersEventRestored(
  supabase: SupabaseServerClient,
  event: RoleEventContext,
  eventCancelledAt: string | null,
): Promise<number> {
  const { opportunities, rows } = await signupsCancelledWithEvent(supabase, event.id, eventCancelledAt);
  for (const [opportunityId, userIds] of byOpportunity(rows)) {
    const opportunity = opportunities.find((o) => o.id === opportunityId);
    if (!opportunity) continue;
    await emailShiftVolunteers(supabase, userIds, opportunity, event, sendVolunteerEventRestoredEmail);
  }
  return rows.length;
}
