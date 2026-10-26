"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { PRACTICAL_OUTCOMES, WAIVED_OUTCOME, type PracticalOutcome } from "@/lib/practical-checks";

export type PracticalCheckResult = { ok: true } | { ok: false; error: string };

/**
 * Records a practical instruction check. Admins can for anyone; a chapter
 * lead for anyone with an application in one of their chapters or on a
 * roster of one of their chapters' events (can_record_practical_check —
 * the database enforces it). Checks aren't edited: a correction is a new
 * one, and the latest counts. A waiver ("waived") is admins only and needs
 * a reason in the notes; the assessor is whoever vouches for them.
 */
export async function recordPracticalCheckAction(
  userId: string,
  input: { checkedOn: string; assessorName: string; outcome: PracticalOutcome | ""; notes: string },
): Promise<PracticalCheckResult> {
  const supabase = await createClient();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.checkedOn)) return { ok: false, error: "Give the date of the check" };
  if (!input.assessorName.trim()) return { ok: false, error: "Say who assessed them" };
  if (!PRACTICAL_OUTCOMES.some((o) => o.value === input.outcome)) return { ok: false, error: "Choose an outcome" };
  if (input.outcome === WAIVED_OUTCOME) {
    if ("error" in (await requireAdmin(supabase))) return { ok: false, error: "Only an admin can waive the practical check" };
    if (!input.notes.trim()) return { ok: false, error: "Say why you're waiving it" };
  }

  const { data: allowed } = await supabase.rpc("can_record_practical_check", { p_user_id: userId });
  if (!allowed) return { ok: false, error: "You can't record a practical check for this person" };

  const { error } = await supabase.from("practical_instruction_checks").insert({
    user_id: userId,
    checked_on: input.checkedOn,
    assessor_name: input.assessorName.trim(),
    outcome: input.outcome,
    notes: input.notes.trim() || null,
  });
  if (error) {
    console.error(`[practical check] for ${userId}: ${error.code} ${error.message}`);
    return { ok: false, error: "The check couldn't be saved — try again." };
  }
  return { ok: true };
}
