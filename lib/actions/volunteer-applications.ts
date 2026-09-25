"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { CHAPTERS, VIRTUAL_CHAPTER } from "@/lib/chapters";
import { formatPhoneNumber } from "@/lib/phone";
import {
  applicationErrors,
  type ApplicationInput,
  type YesNo,
} from "@/lib/volunteer-applications";
import {
  sendApplicationAttendMoreEventsEmail,
  sendApplicationInviteToScheduleEmail,
} from "@/lib/email/send";

export type ApplicationActionResult = { ok: true } | { ok: false; error: string };

const CHAPTER_NAMES = [...CHAPTERS.map((c) => c.name), VIRTUAL_CHAPTER];
const yes = (v: YesNo) => v === "true";
const text = (v: string) => v.trim() || null;

/**
 * Submits a volunteer application. The database works out the rest on
 * insert (volunteer_applications_before_insert): who and when, attendance,
 * whether it starts as Ready to screen or Waiting on attendance, and whether
 * reference 1 is an approved volunteer — the applicant never learns that
 * last part.
 */
export async function submitVolunteerApplicationAction(input: ApplicationInput): Promise<ApplicationActionResult> {
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) return { ok: false, error: "Not authenticated" };

  const errors = applicationErrors(input, CHAPTER_NAMES);
  if (errors.length > 0) return { ok: false, error: errors[0] };

  const { data: roleOptions } = await supabase.rpc("volunteer_application_role_options");
  const validRoleIds = new Set(((roleOptions ?? []) as { id: number }[]).map((r) => r.id));

  const { error } = await supabase.from("volunteer_applications").insert({
    user_id: claims.claims.sub as string,
    // Overwritten by the database (volunteer_applications_before_insert);
    // required by the column.
    status: "waiting_on_attendance",
    full_name: input.fullName.trim(),
    email: input.email.trim().toLowerCase(),
    phone: formatPhoneNumber(input.phone),
    chapters: [...new Set(input.chapters)],
    how_connected: input.howConnected.trim(),
    how_long_attending: input.howLongAttending.trim(),
    why_volunteer: input.whyVolunteer.trim(),
    hope_to_get: input.hopeToGet.trim(),
    mission_connection: text(input.missionConnection),
    role_type_ids: [...new Set(input.roleTypeIds)].filter((id) => validRoleIds.has(id)),
    interested_in_retreats: yes(input.interestedInRetreats),
    years_fly_fishing: input.yearsFlyFishing.trim(),
    water_fished: input.waterFished.trim(),
    has_taught_or_guided: yes(input.hasTaughtOrGuided),
    taught_details: yes(input.hasTaughtOrGuided) ? text(input.taughtDetails) : null,
    beginner_comfort: Number(input.beginnerComfort),
    cert_first_aid_cpr: yes(input.certFirstAidCpr),
    cert_first_aid_cpr_expires: yes(input.certFirstAidCpr) ? input.certFirstAidCprExpires : null,
    cert_wfa_wfr: yes(input.certWfaWfr),
    cert_ffi_casting: yes(input.certFfiCasting),
    cert_guide_license: yes(input.certGuideLicense),
    cert_other: text(input.certOther),
    availability: [...new Set(input.availability)],
    frequency: input.frequency.trim(),
    ref1_name: input.ref1Name.trim(),
    ref1_email: input.ref1Email.trim(),
    ref1_phone: formatPhoneNumber(input.ref1Phone),
    ref1_how_know: input.ref1HowKnow.trim(),
    ref1_chapter: input.ref1Chapter.trim(),
    ref2_name: input.ref2Name.trim(),
    ref2_email: input.ref2Email.trim(),
    ref2_phone: formatPhoneNumber(input.ref2Phone),
    ref2_relationship: input.ref2Relationship.trim(),
    ref2_known_for: input.ref2KnownFor.trim(),
    references_acknowledged: input.referencesAcknowledged,
    anything_else: text(input.anythingElse),
  });
  if (error) {
    // Our own trigger refusals (already on the team, one in progress, a
    // reference that's you) are written for people.
    if (error.code === "P0001") return { ok: false, error: error.message };
    if (error.code === "23505") return { ok: false, error: "You already have an application in progress" };
    console.error(`[volunteer application] submit: ${error.code} ${error.message}`);
    return {
      ok: false,
      error: "Your application couldn't be saved. Everything you entered is still here — try again in a moment.",
    };
  }
  return { ok: true };
}

type Act = "invited_to_schedule" | "asked_to_attend_more" | "declined" | "reapplication_allowed" | "withdrawn";

/** Records an action (status change + history) in the database, which
 * re-checks who may do it. */
async function record(
  supabase: Awaited<ReturnType<typeof createClient>>,
  applicationId: number,
  action: Act,
  options: { note?: string | null; emailed?: boolean } = {},
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("volunteer_application_act", {
    p_application_id: applicationId,
    p_action: action,
    p_note: options.note ?? null,
    p_emailed: options.emailed ?? false,
  });
  return { error: error?.message ?? null };
}

/**
 * "Invite to schedule a call" or "Ask them to attend a few events first" —
 * admins, and chapter leads for applications in their chapters. The email
 * goes first; the status change and who-sent-it are recorded only once it's
 * out, so the history never claims an email that failed.
 */
export async function sendApplicationEmailAction(
  applicationId: number,
  kind: "invite_to_schedule" | "attend_more",
): Promise<ApplicationActionResult> {
  const supabase = await createClient();

  // RLS: only returns the row to someone who may review it.
  const { data: app } = await supabase
    .from("volunteer_applications")
    .select("id, full_name, email, status")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) return { ok: false, error: "Application not found" };
  if (!["waiting_on_attendance", "ready_to_screen", "invited_to_schedule"].includes(app.status as string)) {
    return { ok: false, error: "This application is past that stage" };
  }

  const firstName = (app.full_name as string).split(/\s+/)[0] || null;
  try {
    if (kind === "invite_to_schedule") {
      const { data: settings } = await supabase
        .from("app_settings")
        .select("screening_scheduling_url")
        .maybeSingle();
      const url = (settings?.screening_scheduling_url as string | null)?.trim();
      if (!url) {
        return {
          ok: false,
          error: "There's no scheduling link yet — an admin needs to add it in Setup → Volunteer applications.",
        };
      }
      await sendApplicationInviteToScheduleEmail({ toEmail: app.email as string, recipientName: firstName, schedulingUrl: url });
    } else {
      await sendApplicationAttendMoreEventsEmail({ toEmail: app.email as string, recipientName: firstName });
    }
  } catch (err) {
    console.error(`[volunteer application] ${kind} email for ${applicationId} failed:`, err);
    return { ok: false, error: "The email didn't send, so nothing was changed. Try again in a moment." };
  }

  const { error } = await record(
    supabase,
    applicationId,
    kind === "invite_to_schedule" ? "invited_to_schedule" : "asked_to_attend_more",
    { note: `Emailed ${app.email as string}`, emailed: true },
  );
  if (error) {
    return { ok: false, error: `The email went out, but the status didn't update: ${error}` };
  }
  return { ok: true };
}

/** Decline — admins only (enforced in the database too). The reason is
 * internal; no email is sent. */
export async function declineApplicationAction(
  applicationId: number,
  reason: string,
): Promise<ApplicationActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: "Only an admin can decline an application" };
  const { error } = await record(supabase, applicationId, "declined", { note: reason });
  return error ? { ok: false, error } : { ok: true };
}

/**
 * "Allow re-application" on a declined application — admins only. It stays
 * declined; the person can now apply again. No email: telling them is a
 * separate, deliberate step.
 */
export async function allowReapplicationAction(applicationId: number): Promise<ApplicationActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: "Only an admin can allow re-application" };
  const { error } = await record(supabase, applicationId, "reapplication_allowed");
  return error ? { ok: false, error } : { ok: true };
}

/** Withdraw — the applicant, or an admin. No email. */
export async function withdrawApplicationAction(applicationId: number): Promise<ApplicationActionResult> {
  const supabase = await createClient();
  const { error } = await record(supabase, applicationId, "withdrawn");
  return error ? { ok: false, error } : { ok: true };
}

/**
 * Admin: "events attended before the portal" for one person, with a
 * one-line note of why. Stamped with who and when by the database; a waiting
 * application moves on by itself if this takes it over its target.
 */
export async function setAttendanceCreditAction(
  userId: string,
  events: number,
  note: string,
): Promise<ApplicationActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  if (!Number.isInteger(events) || events < 0 || events > 500) {
    return { ok: false, error: "Enter a whole number of events" };
  }
  if (!note.trim()) return { ok: false, error: "Add a line saying why" };
  const { error } = await supabase
    .from("attendance_credits")
    .upsert({ user_id: userId, events, note: note.trim() }, { onConflict: "user_id" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Admin: the Setup settings for volunteer applications. */
export async function updateApplicationSettingsAction(input: {
  minEventsBeforeScreening: number;
  screeningSchedulingUrl: string;
}): Promise<ApplicationActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  const min = input.minEventsBeforeScreening;
  if (!Number.isInteger(min) || min < 0 || min > 100) return { ok: false, error: "Enter a whole number of events" };
  const url = input.screeningSchedulingUrl.trim();
  if (url && !/^https?:\/\//i.test(url)) return { ok: false, error: "The scheduling link should start with https://" };
  const { error } = await supabase
    .from("app_settings")
    .update({ min_events_before_screening: min, screening_scheduling_url: url || null })
    .eq("id", true);
  return error ? { ok: false, error: error.message } : { ok: true };
}
