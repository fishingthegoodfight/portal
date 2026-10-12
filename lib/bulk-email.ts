import { createAdminClient } from "@/lib/supabase/admin";
import { bulkSendGapMs, sendChapterMessageEmail } from "@/lib/email/send";
import { ensureUnsubscribeToken } from "@/lib/email-preferences";
import { getSiteUrl } from "@/lib/site-url";
import { applyMerge, eventDateLabel, signatureLines, type MergeValues } from "@/lib/bulk-email-text";

/**
 * Members and roster emails (backlog item 7; 2026-10-12 "Email from Members
 * and event rosters" entry in schema-changes.sql). The database decides who
 * may be sent what and queues it (create_bulk_email); this sends the queue,
 * one email per person, in the background:
 *  - right after a send is queued (after(), in lib/actions/bulk-email.ts),
 *    for as long as that request may run;
 *  - every 5 minutes (/api/cron/bulk-email, a Supabase pg_cron job) for
 *    whatever is left.
 * claim_bulk_email_recipient hands out one recipient at a time, so two runs
 * never send the same one. Each sent email to someone it counts for is
 * logged as an "email" touch by the sender, so Members shows it at once.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

type QueuedRecipient = {
  id: number;
  bulk_email_id: number;
  user_id: string;
  email: string;
  first_name: string | null;
  chapter: string | null;
  count_touch: boolean;
};

type BulkEmailRow = {
  id: number;
  source: "members" | "roster";
  chapter: string | null;
  event_id: number | null;
  subject: string;
  body: string;
  sender_id: string | null;
  sender_name: string;
  sender_email: string;
};

/** The "stop chapter emails" page and its one-click POST, for one person. */
export function chapterEmailLinks(token: string) {
  const site = getSiteUrl();
  return {
    stopUrl: `${site}/unsubscribe/${token}?list=chapter`,
    oneClickUrl: `${site}/api/unsubscribe/${token}?list=chapter`,
  };
}

/** {event_name} and {event_date} for a roster email's event. */
export async function eventMergeValues(client: AdminClient, eventId: number | null): Promise<MergeValues> {
  if (eventId == null) return {};
  const { data } = await client.from("events").select("name, starts_at, timezone").eq("id", eventId).maybeSingle();
  if (!data) return {};
  return {
    event_name: data.name as string,
    event_date: eventDateLabel(data.starts_at as string, data.timezone as string),
  };
}

export type QueueRunSummary = { sent: number; failed: number; leftForLater: boolean };

/**
 * Sends queued recipients until the queue is empty or `deadline` (epoch
 * ms) is near. Anything left goes out on the next run.
 */
export async function processBulkEmailQueue(deadline: number): Promise<QueueRunSummary> {
  const admin = createAdminClient();
  const gap = bulkSendGapMs();
  const jobs = new Map<number, { job: BulkEmailRow; event: MergeValues }>();
  const summary: QueueRunSummary = { sent: 0, failed: 0, leftForLater: false };
  let first = true;

  while (true) {
    if (Date.now() + gap + 15_000 >= deadline) {
      summary.leftForLater = true;
      break;
    }
    const { data: claimed, error: claimError } = await admin.rpc("claim_bulk_email_recipient");
    if (claimError) throw new Error(`claim_bulk_email_recipient: ${claimError.message}`);
    const recipient = ((claimed ?? []) as QueuedRecipient[])[0];
    if (!recipient) break;

    if (!first) await new Promise((resolve) => setTimeout(resolve, gap));
    first = false;

    try {
      let entry = jobs.get(recipient.bulk_email_id);
      if (!entry) {
        const { data: job, error } = await admin
          .from("bulk_emails")
          .select("id, source, chapter, event_id, subject, body, sender_id, sender_name, sender_email")
          .eq("id", recipient.bulk_email_id)
          .single();
        if (error || !job) throw new Error(`loading the message: ${error?.message ?? "not found"}`);
        entry = { job: job as BulkEmailRow, event: await eventMergeValues(admin, (job as BulkEmailRow).event_id) };
        jobs.set(recipient.bulk_email_id, entry);
      }
      const { job, event } = entry;
      const values: MergeValues = { ...event, first_name: recipient.first_name, chapter: recipient.chapter };
      const subject = applyMerge(job.subject, values);
      const token = await ensureUnsubscribeToken(recipient.user_id);
      const links = chapterEmailLinks(token);

      await sendChapterMessageEmail({
        toEmail: recipient.email,
        replyTo: job.sender_email,
        oneClickUrl: links.oneClickUrl,
        content: {
          subject,
          body: applyMerge(job.body, values),
          signature: signatureLines(job.sender_name, job.chapter),
          stopUrl: links.stopUrl,
        },
      });
      await admin
        .from("bulk_email_recipients")
        .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
        .eq("id", recipient.id);
      summary.sent += 1;

      if (recipient.count_touch) {
        const { error: touchError } = await admin.from("member_touches").insert({
          member_id: recipient.user_id,
          touch_type: "email",
          note: `Email: ${subject}`.slice(0, 280),
          logged_by: job.sender_id,
          logged_by_name: "",
        });
        if (touchError) console.error("[bulk-email] couldn't log the touch:", touchError.message);
      }
    } catch (err) {
      summary.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[bulk-email] recipient ${recipient.id} failed:`, message);
      await admin
        .from("bulk_email_recipients")
        .update({ status: "failed", error: message.slice(0, 500) })
        .eq("id", recipient.id);
    }
  }

  // Every open send, not just this run's: one whose last recipient was
  // marked failed while stuck is finished too.
  const { data: open } = await admin.from("bulk_emails").select("id").is("finished_at", null);
  await markFinished(admin, (open ?? []).map((row) => row.id as number));
  return summary;
}

/** Stamps finished_at on sends with nothing left queued or sending. */
async function markFinished(admin: AdminClient, ids: number[]) {
  for (const id of ids) {
    const { count } = await admin
      .from("bulk_email_recipients")
      .select("id", { count: "exact", head: true })
      .eq("bulk_email_id", id)
      .in("status", ["queued", "sending"]);
    if (count === 0) {
      await admin.from("bulk_emails").update({ finished_at: new Date().toISOString() }).eq("id", id).is("finished_at", null);
    }
  }
}
