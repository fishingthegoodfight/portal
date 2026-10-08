"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { bulkSendGapMs } from "@/lib/email/send";
import { loadWalkupWelcomeCandidates, sendWalkupWelcome } from "@/lib/walkup-welcome";

export type WalkupWelcomeSendResult =
  | { ok: true; sent: string[]; failed: { userId: string; error: string }[]; skipped: string[] }
  | { ok: false; error: string };

/**
 * Setup → Walk-up welcome emails: sends the welcome to the people the admin
 * ticked. Admins only. The list is re-read here and only people still on it
 * are sent to (`skipped` is anyone ticked who has since signed in, been
 * sent one, or dropped off), so a stale page can't send twice. Each send is
 * recorded in walkup_welcome_emails (source 'catch_up', who sent it); a
 * failure keeps its error and leaves them on the list.
 */
export async function sendWalkupWelcomeCatchUpAction(userIds: string[]): Promise<WalkupWelcomeSendResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Admin client unavailable" };
  }

  let candidates;
  try {
    candidates = await loadWalkupWelcomeCandidates(admin);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const picked = new Set(userIds);
  const toSend = candidates.filter((c) => picked.has(c.userId));
  const onList = new Set(toSend.map((c) => c.userId));
  const result = {
    ok: true as const,
    sent: [] as string[],
    failed: [] as { userId: string; error: string }[],
    skipped: userIds.filter((id) => !onList.has(id)),
  };

  const gap = bulkSendGapMs();
  const now = new Date();
  for (const [index, recipient] of toSend.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, gap));
    const { error: recordError } = await admin.from("walkup_welcome_emails").upsert(
      {
        user_id: recipient.userId,
        event_id: recipient.eventId,
        source: "catch_up",
        sent_by: adminCheck.actor.userId,
        last_error: null,
      },
      { onConflict: "user_id" },
    );
    if (recordError) {
      result.failed.push({ userId: recipient.userId, error: `Not sent: ${recordError.message}` });
      continue;
    }
    try {
      await sendWalkupWelcome(recipient, now);
      await admin
        .from("walkup_welcome_emails")
        .update({ sent_at: new Date().toISOString() })
        .eq("user_id", recipient.userId);
      result.sent.push(recipient.userId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[walkup-welcome] catch-up send to ${recipient.userId} failed:`, err);
      await admin.from("walkup_welcome_emails").update({ last_error: message }).eq("user_id", recipient.userId);
      result.failed.push({ userId: recipient.userId, error: message });
    }
  }
  return result;
}
