"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { sendSms } from "@/lib/twilio";

type Result = { ok: true; message?: string } | { ok: false; error: string };

/**
 * "Log text" on an event roster: records a "text" touch (log_roster_text).
 * The database checks the caller manages the event and the person is on
 * it. Like roster emails, it only counts as Members outreach for someone
 * whose home chapter is the event's (or whom the caller can see on Members).
 */
export async function logRosterTextAction(eventId: number, memberId: string): Promise<Result> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("log_roster_text", { p_event_id: eventId, p_member_id: memberId });
  if (error) return { ok: false, error: error.code === "42501" ? "You can't log that." : error.message };
  return data === "logged" ? { ok: true } : { ok: true, message: "Not logged: another chapter's member" };
}

/**
 * Setup → Texting: texts the signed-in admin's own number through the
 * Messaging Service (lib/twilio.ts sendSms), with the same consent check
 * as any text, so it only goes if they've agreed to texts on their profile.
 */
export async function sendTestTextAction(): Promise<Result> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if ("error" in gate) return { ok: false, error: gate.error };
  const result = await sendSms({
    userId: gate.actor.userId,
    senderId: gate.actor.userId,
    body: "Test text from the Fishing the Good Fight portal. If you got this, texting works.",
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, message: `Sent (Twilio status: ${result.status}). Check your phone.` };
}
