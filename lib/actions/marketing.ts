"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { MARKETING_CHANNELS, type MarketingChannel } from "@/lib/marketing";

export type SetPostedResult = { ok: true } | { ok: false; error: string };

/**
 * Admin-only: tick or untick "Posted to <channel>" for an event
 * (event_marketing_posts). Ticking records who and when — stamped by the
 * database, not taken from here; unticking removes the record.
 */
export async function setEventPostedAction(
  eventId: number,
  channel: MarketingChannel,
  posted: boolean,
): Promise<SetPostedResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  if (!Number.isInteger(eventId)) return { ok: false, error: "Unknown event" };
  if (!MARKETING_CHANNELS.includes(channel)) return { ok: false, error: "Unknown channel" };

  if (posted) {
    const { error } = await supabase
      .from("event_marketing_posts")
      .insert({ event_id: eventId, channel });
    // 23505: already ticked (another tab, or someone else) — keep theirs.
    if (error && error.code !== "23505") return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from("event_marketing_posts")
      .delete()
      .eq("event_id", eventId)
      .eq("channel", channel);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}
