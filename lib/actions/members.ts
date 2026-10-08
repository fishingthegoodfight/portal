"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  MEMBER_SETTING_COLUMNS,
  TOUCH_TYPES,
  type MemberSettings,
  type TouchType,
} from "@/lib/members";

export type MembersActionResult = { ok: true } | { ok: false; error: string };

/**
 * Logs a touch on someone in Members. Anyone who can see them may (the
 * member_touches insert policy, can_view_member); who logged it and the
 * chapter are stamped by the database. Once logged, they drop off "needs a
 * touch" and their drop alert closes.
 */
export async function logMemberTouchAction(input: {
  memberId: string;
  type: TouchType;
  touchedOn: string;
  note: string;
}): Promise<MembersActionResult> {
  const supabase = await createClient();
  if (!(TOUCH_TYPES as readonly string[]).includes(input.type)) return { ok: false, error: "Choose call, text, in person or email." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.touchedOn)) return { ok: false, error: "Choose a date." };
  const note = input.note.trim();
  if (note.length > 280) return { ok: false, error: "Keep the note to 280 characters." };
  const { error } = await supabase.from("member_touches").insert({
    member_id: input.memberId,
    touch_type: input.type,
    touched_on: input.touchedOn,
    note: note || null,
    logged_by_name: "",
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "You can't log a touch for this person." };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Admins: sets the home chapter of someone under "No chapter". */
export async function setMemberChapterAction(memberId: string, chapter: string): Promise<MembersActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  const { error } = await supabase.rpc("admin_set_member_chapter", { p_user_id: memberId, p_chapter: chapter });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Admins: Setup → Members thresholds. */
export async function saveMemberSettingsAction(settings: MemberSettings): Promise<MembersActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  const update: Record<string, number> = {};
  for (const [key, column] of Object.entries(MEMBER_SETTING_COLUMNS) as [keyof MemberSettings, string][]) {
    const value = Math.trunc(Number(settings[key]));
    if (!Number.isFinite(value) || value < 1 || value > 3650) return { ok: false, error: "Every setting must be a whole number of at least 1." };
    update[column] = value;
  }
  if (update.members_active_days >= update.members_dropped_days) {
    return { ok: false, error: "Active has to end before Dropped starts." };
  }
  const { error } = await supabase.from("app_settings").update(update).eq("id", true);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
