import type { createAdminClient } from "@/lib/supabase/admin";
import { sendReferenceRequestEmail } from "@/lib/email/send";
import {
  REFERENCE_MAX_REMINDERS,
  referenceByDate,
  reminderStepDue,
  type ReferenceSlot,
} from "@/lib/volunteer-references";

type AdminClient = ReturnType<typeof createAdminClient>;

export type ReferenceReminderSummary = {
  /** Live, unanswered requests on applications at References out: what the
   * run looked at, whether or not anything was due. */
  checked: number;
  reminded: string[];
  gaveUp: string[];
  failed: string[];
  /** Dry run: what would have happened. */
  dry: boolean;
};

type DueRow = {
  id: number;
  application_id: number;
  slot: ReferenceSlot;
  name: string;
  email: string;
  requested_at: string;
  reminders_sent: number;
  last_reminder_at: string | null;
  gave_up_at: string | null;
  volunteer_applications: { full_name: string } | null;
};

/**
 * The weekly reference reminders (schedule in lib/volunteer-references.ts),
 * run once a day from the admin-digest cron — before the digest is built, so
 * a reference that gives up today is in today's digest. Every live,
 * unanswered request on an application still at References out gets at most
 * one step per run (reminderStepDue): automatic reminder N, or the "gave up"
 * flag a week after the third. Each reminder claims its row first (reminders_sent moves only
 * from N-1 to N), so overlapping runs can't send it twice; a failed email
 * puts the count back so tomorrow's run tries again.
 *
 * `now` is the day to act as — the dev endpoint passes a pretend date.
 * `applicationId` limits the run to one application (the dev endpoint
 * always does, so testing never touches anyone else's references).
 */
export async function runReferenceReminders(
  admin: AdminClient,
  options: { now: Date; applicationId?: number; dry?: boolean },
): Promise<ReferenceReminderSummary> {
  const { now, applicationId, dry = false } = options;
  let query = admin
    .from("volunteer_reference_requests")
    .select(
      "id, application_id, slot, name, email, requested_at, reminders_sent, last_reminder_at, gave_up_at, volunteer_applications!inner(full_name, status)",
    )
    .is("replaced_at", null)
    .is("submitted_at", null)
    .eq("volunteer_applications.status", "references_out");
  if (applicationId != null) query = query.eq("application_id", applicationId);
  const { data, error } = await query;
  if (error) throw new Error(`loading reference requests: ${error.message}`);

  const summary: ReferenceReminderSummary = { checked: (data ?? []).length, reminded: [], gaveUp: [], failed: [], dry };
  for (const row of (data ?? []) as unknown as DueRow[]) {
    const step = reminderStepDue(
      new Date(row.requested_at),
      row.reminders_sent,
      row.last_reminder_at ? new Date(row.last_reminder_at) : null,
      row.gave_up_at != null,
      now,
    );
    if (!step) continue;
    const applicant = row.volunteer_applications?.full_name ?? "the applicant";
    const who = `${applicant}, reference ${row.slot} (${row.name})`;

    if (step.kind === "give_up") {
      if (!dry) {
        const { error: flagError } = await admin
          .from("volunteer_reference_requests")
          .update({ gave_up_at: now.toISOString() })
          .eq("id", row.id)
          .is("gave_up_at", null);
        if (flagError) {
          summary.failed.push(`${who}: ${flagError.message}`);
          continue;
        }
      }
      summary.gaveUp.push(who);
      continue;
    }

    const label = `${who}: reminder ${step.number} of ${REFERENCE_MAX_REMINDERS}`;
    if (dry) {
      summary.reminded.push(label);
      continue;
    }
    const { data: claimed, error: claimError } = await admin
      .from("volunteer_reference_requests")
      .update({ reminders_sent: step.number, last_reminder_at: now.toISOString() })
      .eq("id", row.id)
      .eq("reminders_sent", step.number - 1)
      .select("id");
    if (claimError) {
      summary.failed.push(`${label}: ${claimError.message}`);
      continue;
    }
    if (!claimed || claimed.length === 0) continue; // another run got it

    try {
      const { data: tokenRow, error: tokenError } = await admin
        .from("volunteer_reference_tokens")
        .select("token")
        .eq("request_id", row.id)
        .is("used_at", null)
        .maybeSingle();
      if (tokenError || !tokenRow) throw new Error(tokenError?.message ?? "no live link for this reference");
      await sendReferenceRequestEmail({
        toEmail: row.email,
        referenceName: row.name,
        applicantName: applicant,
        slot: row.slot,
        token: tokenRow.token as string,
        kind: "reminder",
        byDate: referenceByDate(now),
      });
      await admin.from("volunteer_application_events").insert({
        application_id: row.application_id,
        action: "reference_reminder_sent",
        note: `Reference ${row.slot}: ${row.name} — reminder ${step.number} of ${REFERENCE_MAX_REMINDERS}`,
        emailed: true,
      });
      summary.reminded.push(label);
    } catch (err) {
      // Put the count back so the next run tries again.
      await admin
        .from("volunteer_reference_requests")
        .update({ reminders_sent: step.number - 1, last_reminder_at: row.last_reminder_at })
        .eq("id", row.id)
        .eq("reminders_sent", step.number);
      summary.failed.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary;
}
