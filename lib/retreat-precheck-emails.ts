import type { SupabaseClient } from "@supabase/supabase-js";

import { emailPrecheck } from "@/lib/retreat-emails";
import { addDays, dateInZone, daysBetween } from "@/lib/format-date";
import { formatDueDate, PRECHECK_OPENS_DAYS } from "@/lib/retreat-registration";
import type { PrecheckEmailKind } from "@/lib/email/retreat-templates";

/**
 * The pre-retreat check emails, from the daily job, for every confirmed
 * participant whose check isn't done. By local date in the retreat's zone:
 *   - "opened": the day the check opens (or the first run after someone is
 *     confirmed while it's open)
 *   - "reminder": every 2 days after that, until it's due
 *   - "due_tomorrow": the day before it's due
 *   - "overdue": once, the first run after the due date (the roster flags
 *     them too; nothing cancels automatically)
 * The precheck_* columns on the registration record what went out, and each
 * send claims its row with a conditional update first, so an overlapping or
 * repeated run sends nothing twice. A failed send puts the columns back, so
 * the next run tries again.
 */

export type PrecheckRunSummary = {
  retreats: number;
  sent: Record<PrecheckEmailKind, number>;
  skipped: number;
  failed: string[];
};

type Retreat = { id: number; name: string; starts_at: string; ends_at: string | null; timezone: string; lead_user_id: string | null };
type Registration = {
  id: number;
  user_id: string | null;
  precheck_opened_email_at: string | null;
  precheck_reminded_on: string | null;
  precheck_due_tomorrow_email_at: string | null;
  precheck_overdue_email_at: string | null;
};

const REMINDER_EVERY_DAYS = 2;

/** Which email (if any) a registration gets today. */
function nextEmail(r: Registration, today: string, dueOn: string): PrecheckEmailKind | null {
  if (today > dueOn) return r.precheck_overdue_email_at ? null : "overdue";
  if (!r.precheck_opened_email_at) return "opened";
  if (today === addDays(dueOn, -1)) return r.precheck_due_tomorrow_email_at ? null : "due_tomorrow";
  if (!r.precheck_reminded_on || daysBetween(r.precheck_reminded_on, today) >= REMINDER_EVERY_DAYS) return "reminder";
  return null;
}

export async function runRetreatPrecheckEmails(
  supabase: SupabaseClient,
  { now, dry }: { now: Date; dry: boolean },
): Promise<PrecheckRunSummary> {
  const summary: PrecheckRunSummary = {
    retreats: 0,
    sent: { opened: 0, reminder: 0, due_tomorrow: 0, overdue: 0 },
    skipped: 0,
    failed: [],
  };

  // Coarse UTC window (a day of slack either side); exact dates below.
  const { data: retreats, error } = await supabase
    .from("events")
    .select("id, name, starts_at, ends_at, timezone, lead_user_id")
    .eq("kind", "retreat")
    .neq("status", "cancelled")
    .gt("starts_at", now.toISOString())
    .lt("starts_at", new Date(now.getTime() + (PRECHECK_OPENS_DAYS + 2) * 86_400_000).toISOString());
  if (error) throw new Error(`loading retreats: ${error.message}`);

  for (const retreat of (retreats ?? []) as Retreat[]) {
    const { data: dates } = await supabase.rpc("retreat_precheck_dates", { p_event_id: retreat.id });
    const check = ((dates ?? []) as { opens_on: string; due_on: string }[])[0];
    const today = dateInZone(now, retreat.timezone);
    if (!check || today < check.opens_on) continue;
    summary.retreats++;
    const dueLabel = formatDueDate(check.due_on);

    const { data: regs, error: regError } = await supabase
      .from("retreat_registrations")
      .select("id, user_id, precheck_opened_email_at, precheck_reminded_on, precheck_due_tomorrow_email_at, precheck_overdue_email_at")
      .eq("event_id", retreat.id)
      .eq("status", "confirmed")
      .not("user_id", "is", null)
      .is("precheck_overdue_email_at", null);
    if (regError) {
      summary.failed.push(`retreat ${retreat.id}: ${regError.message}`);
      continue;
    }
    const due = ((regs ?? []) as Registration[])
      .map((r) => ({ r, kind: nextEmail(r, today, check.due_on) }))
      .filter((x): x is { r: Registration; kind: PrecheckEmailKind } => x.kind != null);
    if (due.length === 0) continue;

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email, first_name, last_name")
      .in("id", due.map((x) => x.r.user_id as string));
    const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));

    for (const { r, kind } of due) {
      const { data: state } = await supabase.rpc("retreat_precheck_state", {
        p_user_id: r.user_id,
        p_event_id: retreat.id,
      });
      if (state === "done") continue;
      const person = byId.get(r.user_id as string);
      const email = (person?.email as string | null) ?? "";
      if (!email) {
        summary.skipped++;
        continue;
      }
      if (dry) {
        summary.skipped++;
        console.log(`[retreat-precheck] DRY retreat ${retreat.id} (${kind}): would send to ${email}`);
        continue;
      }

      // Claim: set what this send records, only if nobody else has.
      const stamp = new Date().toISOString();
      const remindedBefore = { precheck_reminded_on: r.precheck_reminded_on };
      const plan: { after: Partial<Registration>; before: Partial<Registration>; unclaimed: keyof Registration } =
        kind === "overdue"
          ? { after: { precheck_overdue_email_at: stamp }, before: { precheck_overdue_email_at: null }, unclaimed: "precheck_overdue_email_at" }
          : kind === "opened"
            ? {
                after: { precheck_opened_email_at: stamp, precheck_reminded_on: today },
                before: { precheck_opened_email_at: null, ...remindedBefore },
                unclaimed: "precheck_opened_email_at",
              }
            : kind === "due_tomorrow"
              ? {
                  after: { precheck_due_tomorrow_email_at: stamp, precheck_reminded_on: today },
                  before: { precheck_due_tomorrow_email_at: null, ...remindedBefore },
                  unclaimed: "precheck_due_tomorrow_email_at",
                }
              : { after: { precheck_reminded_on: today }, before: remindedBefore, unclaimed: "precheck_reminded_on" };
      const update = supabase.from("retreat_registrations").update(plan.after).eq("id", r.id);
      // A reminder claims against the date it last went (or none).
      const claim =
        kind === "reminder" && r.precheck_reminded_on
          ? update.eq("precheck_reminded_on", r.precheck_reminded_on)
          : update.is(plan.unclaimed, null);

      try {
        const { data: claimed, error: claimError } = await claim.select("id");
        if (claimError) throw claimError;
        if (!claimed?.length) {
          summary.skipped++;
          continue;
        }
        try {
          await emailPrecheck(
            retreat,
            {
              email,
              first_name: (person?.first_name as string | null) ?? null,
              last_name: (person?.last_name as string | null) ?? null,
            },
            kind,
            dueLabel,
          );
        } catch (sendErr) {
          await supabase.from("retreat_registrations").update(plan.before).eq("id", r.id);
          throw sendErr;
        }
        summary.sent[kind]++;
      } catch (err) {
        summary.failed.push(`retreat ${retreat.id} registration ${r.id} (${kind}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return summary;
}
