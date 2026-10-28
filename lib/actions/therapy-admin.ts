"use server";

import { createClient } from "@/lib/supabase/server";
import { canManageTherapySupport } from "@/lib/therapy-access";
import { formatPhoneNumber } from "@/lib/phone";
import { sendSupportRequestStatusEmail } from "@/lib/email/send";
import { isSupportStatus, parseDollarsToCents, type SupportStatus } from "@/lib/therapy-support";

export type TherapyActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Every Therapy Support action checks can_manage_therapy_support() (an admin
 * AND the flag) here first, as the Server Actions security docs ask, and
 * the database function it calls checks it again.
 */
async function gate(): Promise<{ supabase: Supabase } | { error: string }> {
  const supabase = await createClient();
  if (!(await canManageTherapySupport(supabase))) return { error: "Not allowed" };
  return { supabase };
}

/** What a status-change function returns: the new status and who to tell. */
type StatusResult = { status: string; email: string | null; first_name: string | null; changed?: boolean };

/** Every status change emails the participant (discreetly). A deleted
 * person has no email; a failed send never undoes the change. Returns
 * whether it went. */
async function emailStatus(result: StatusResult): Promise<boolean> {
  if (result.changed === false || !result.email || !isSupportStatus(result.status)) return false;
  try {
    await sendSupportRequestStatusEmail({
      toEmail: result.email,
      recipientName: result.first_name?.trim() || null,
      status: result.status,
    });
    return true;
  } catch (err) {
    console.error("[therapy admin] status email:", err instanceof Error ? err.message : err);
    return false;
  }
}

export type TherapistInput = {
  name: string;
  practice: string;
  email: string;
  phone: string;
  licenseType: string;
  licenseState: string;
};

/** Create (id null) or update a therapist record. Returns its id. */
export async function saveTherapistAction(
  id: number | null,
  input: TherapistInput,
): Promise<TherapyActionResult<{ id: number }>> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  if (!input.name.trim()) return { ok: false, error: "Add the therapist's name" };
  const { data, error } = await g.supabase.rpc("therapy_admin_save_therapist", {
    p_id: id,
    p_name: input.name,
    p_practice: input.practice,
    p_email: input.email,
    p_phone: input.phone.trim() ? formatPhoneNumber(input.phone) : "",
    p_license_type: input.licenseType,
    p_license_state: input.licenseState,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { id: data as number } };
}

export type DecisionResult = TherapyActionResult<{ status: SupportStatus; emailed: boolean }>;

async function finish(
  rpc: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<DecisionResult> {
  const { data, error } = await rpc;
  if (error) return { ok: false, error: error.message };
  const result = data as StatusResult;
  const emailed = await emailStatus(result);
  return { ok: true, data: { status: result.status as SupportStatus, emailed } };
}

/** Scholarship: the therapist record, their agreement to the flat rate,
 * and (with no check-ins) the override reason. Approves 12 sessions at the
 * current rate. */
export async function approveScholarshipAction(
  requestId: number,
  therapistId: number,
  rateAgreed: boolean,
  overrideReason: string,
): Promise<DecisionResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  return finish(
    g.supabase.rpc("therapy_admin_approve_scholarship", {
      p_id: requestId,
      p_therapist_id: therapistId,
      p_rate_agreed: rateAgreed,
      p_override_reason: overrideReason,
    }),
  );
}

/** Partner office: referred, or waitlisted for next month when this
 * month's sessions are used up (the database decides). */
export async function referPartnerAction(requestId: number, overrideReason: string): Promise<DecisionResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  return finish(g.supabase.rpc("therapy_admin_refer_partner", { p_id: requestId, p_override_reason: overrideReason }));
}

export async function setSupportStatusAction(
  requestId: number,
  status: "declined" | "waitlisted" | "complete",
): Promise<DecisionResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  return finish(g.supabase.rpc("therapy_admin_set_status", { p_id: requestId, p_status: status }));
}

export async function saveTherapySettingsAction(input: {
  scholarshipRate: string;
  partnerMonthlySessions: string;
}): Promise<TherapyActionResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const rate = input.scholarshipRate.trim() ? parseDollarsToCents(input.scholarshipRate) : null;
  if (input.scholarshipRate.trim() && (rate === null || rate <= 0)) {
    return { ok: false, error: "Enter the flat rate as a dollar amount, like 60" };
  }
  const slots = Number(input.partnerMonthlySessions);
  if (!Number.isInteger(slots) || slots < 0) return { ok: false, error: "Enter the partner office's sessions as a whole number" };

  const { error } = await g.supabase.rpc("therapy_admin_update_settings", {
    p_scholarship_rate_cents: rate,
    p_partner_monthly_sessions: slots,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Give an admin Therapy Support access, or take it away. */
export async function setTherapyManagerAction(userId: string, on: boolean): Promise<TherapyActionResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const { error } = await g.supabase.rpc("therapy_admin_set_manager", { p_user_id: userId, p_on: on });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
