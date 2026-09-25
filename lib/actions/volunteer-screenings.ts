"use server";

import { createClient } from "@/lib/supabase/server";
import {
  READS,
  screeningErrors,
  SCREENABLE_STATUSES,
  sectionsFor,
  type ScreeningInput,
} from "@/lib/volunteer-screenings";

export type ScreeningActionResult = { ok: true } | { ok: false; error: string };

const text = (v: string | undefined) => (v ?? "").trim() || null;

/**
 * Records a new screening call, or saves edits to one. Who may is decided
 * by the database (can_record_screening: the screening flag AND being able
 * to see the application; editing also needs to be its recorder or an
 * admin), which also stamps who/when and moves the application's status —
 * a chapter lead's "Not a fit right now" lands as a recommendation for an
 * admin.
 */
export async function saveScreeningAction(
  applicationId: number,
  screeningId: number | null,
  input: ScreeningInput,
): Promise<ScreeningActionResult> {
  const supabase = await createClient();
  const { data: canRecord } = await supabase.rpc("can_record_screening", { p_application_id: applicationId });
  if (!canRecord) return { ok: false, error: "You can't record screening calls for this application" };

  const { data: app } = await supabase
    .from("volunteer_applications")
    .select("status, interested_in_retreats")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) return { ok: false, error: "Application not found" };

  // A new call follows the application's retreat answer; an edit keeps the
  // track it was recorded with.
  let retreatTrack = Boolean(app.interested_in_retreats);
  if (screeningId != null) {
    const { data: existing } = await supabase
      .from("volunteer_screenings")
      .select("retreat_track")
      .eq("id", screeningId)
      .eq("application_id", applicationId)
      .maybeSingle();
    if (!existing) return { ok: false, error: "Screening not found" };
    retreatTrack = Boolean(existing.retreat_track);
  } else if (!SCREENABLE_STATUSES.includes(app.status as string)) {
    return { ok: false, error: "A screening can be recorded once they've been invited to schedule a call" };
  }

  const errors = screeningErrors(input, retreatTrack);
  if (errors.length > 0) return { ok: false, error: errors[0] };

  const { data: roleTypes } = await supabase.from("volunteer_role_types").select("id").eq("active", true);
  const activeRoleIds = new Set(((roleTypes ?? []) as { id: number }[]).map((r) => r.id));

  const row: Record<string, unknown> = {
    call_date: input.callDate,
    interviewer_name: input.interviewerName.trim(),
    length_minutes: input.lengthMinutes.trim() ? Number(input.lengthMinutes.trim()) : null,
    retreat_track: retreatTrack,
    recommended_role_type_ids: [...new Set(input.recommendedRoleTypeIds)].filter((id) => activeRoleIds.has(id)),
    outcome: input.outcome,
    summary: input.summary.trim(),
  };
  // The other track's sections are cleared, not left over.
  for (const key of ["why_here", "struggling", "fishing_skill", "water_safety", "chapter_help", "working_with_us"] as const) {
    row[`${key}_level`] = null;
    row[`${key}_concern`] = false;
    row[`${key}_notes`] = null;
  }
  for (const section of sectionsFor(retreatTrack)) {
    row[`${section.key}_level`] = input.levels[section.key];
    row[`${section.key}_concern`] = input.concerns[section.key] === true;
    row[`${section.key}_notes`] = text(input.notes[section.key]);
  }
  for (const read of READS) row[`read_${read.key}`] = input.reads[read.key];

  // An edit RLS doesn't allow updates nothing rather than erroring — so ask
  // for the row back and treat "none" as refused.
  const { data: saved, error } =
    screeningId == null
      ? await supabase.from("volunteer_screenings").insert({ ...row, application_id: applicationId }).select("id")
      : await supabase
          .from("volunteer_screenings")
          .update(row)
          .eq("id", screeningId)
          .eq("application_id", applicationId)
          .select("id");
  if (!error && (saved ?? []).length === 0) {
    return { ok: false, error: "Only the person who recorded this call, or an admin, can edit it" };
  }
  if (error) {
    console.error(`[screening] save for application ${applicationId}: ${error.code} ${error.message}`);
    if (error.code === "42501") {
      return { ok: false, error: "Only the person who recorded this call, or an admin, can edit it" };
    }
    return { ok: false, error: "The screening couldn't be saved. Everything you entered is still here — try again." };
  }
  return { ok: true };
}
