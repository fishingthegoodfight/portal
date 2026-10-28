"use server";

import { createClient } from "@/lib/supabase/server";
import { formatPhoneNumber } from "@/lib/phone";
import { sendSupportRequestStatusEmail } from "@/lib/email/send";
import { isSupportProgram, type SupportRequestInput } from "@/lib/therapy-support";

export type SupportActionResult = { ok: true } | { ok: false; error: string };

/** The "we've received it" email to the signed-in participant. Never fails
 * the request: it's already saved. */
async function emailSubmitted(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  try {
    const { data: profile } = await supabase.from("profiles").select("email, first_name").eq("id", userId).maybeSingle();
    if (!profile?.email) return;
    await sendSupportRequestStatusEmail({
      toEmail: profile.email as string,
      recipientName: (profile.first_name as string | null)?.trim() || null,
      status: "submitted",
    });
  } catch (err) {
    console.error("[support] submitted email:", err instanceof Error ? err.message : err);
  }
}

/**
 * The participant's request. submit_support_request() does the checking
 * (one open request at a time, the fields each path needs) and copies their
 * chapter in; only the chosen path's fields are kept.
 */
export async function submitSupportRequestAction(input: SupportRequestInput): Promise<SupportActionResult> {
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) return { ok: false, error: "Please sign in again" };
  const userId = claims.claims.sub as string;

  if (!isSupportProgram(input.program)) return { ok: false, error: "Let us know whether you currently have a therapist" };
  const scholarship = input.program === "scholarship";
  if (scholarship && !input.therapistName.trim()) return { ok: false, error: "Add your therapist's name" };
  if (scholarship && !input.hasInsurance) return { ok: false, error: "Let us know whether you have insurance that could help" };
  if (!scholarship && !input.contactPreference) return { ok: false, error: "Choose how you'd like to be contacted" };

  const { error } = await supabase.rpc("submit_support_request", {
    p_program: input.program,
    p_therapist_name: scholarship ? input.therapistName : null,
    p_therapist_practice: scholarship ? input.therapistPractice : null,
    p_therapist_email: scholarship ? input.therapistEmail : null,
    p_therapist_phone: scholarship && input.therapistPhone.trim() ? formatPhoneNumber(input.therapistPhone) : null,
    p_therapist_license_type: scholarship ? input.therapistLicenseType : null,
    p_therapist_license_state: scholarship ? input.therapistLicenseState : null,
    p_has_insurance: scholarship ? input.hasInsurance : null,
    p_contact_preference: scholarship ? null : input.contactPreference,
    p_availability: scholarship ? null : input.availability,
    p_note: input.note,
  });
  if (error) return { ok: false, error: error.message };

  await emailSubmitted(supabase, userId);
  return { ok: true };
}

/** A renewal of an approval whose sessions are all used: linked to it, and
 * reviewed like any request. */
export async function requestSupportRenewalAction(previousId: number, note: string): Promise<SupportActionResult> {
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) return { ok: false, error: "Please sign in again" };

  const { error } = await supabase.rpc("request_support_renewal", { p_previous_id: previousId, p_note: note });
  if (error) return { ok: false, error: error.message };

  await emailSubmitted(supabase, claims.claims.sub as string);
  return { ok: true };
}
