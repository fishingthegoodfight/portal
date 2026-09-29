"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Setup → Volunteer opportunities email: on/off, the anchor date and the
 * weekday (see lib/opportunities-schedule.ts). */
export async function updateOpportunitiesEmailSettingsAction(input: {
  enabled: boolean;
  anchor: string;
  weekday: number;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.anchor) || Number.isNaN(Date.parse(`${input.anchor}T00:00:00Z`))) {
    return { ok: false, error: "Choose an anchor date" };
  }
  if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) {
    return { ok: false, error: "Choose a day of the week" };
  }
  const { error } = await supabase
    .from("app_settings")
    .update({
      opportunities_email_enabled: input.enabled,
      opportunities_email_anchor: input.anchor,
      opportunities_email_weekday: input.weekday,
    })
    .eq("id", true);
  return error ? { ok: false, error: error.message } : { ok: true };
}
