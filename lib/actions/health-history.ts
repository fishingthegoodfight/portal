"use server";

import { createClient } from "@/lib/supabase/server";
import { formatPhoneNumber } from "@/lib/phone";
import { healthFormYearFor } from "@/lib/health-requirements";
import {
  conditionsNeedingExplanation,
  followUpsFor,
  healthHistoryErrors,
  type HealthHistoryInput,
  type YesNo,
} from "@/lib/health-history";
import { requireEventManager } from "@/lib/admin/require-admin";

export type HealthActionResult = { ok: true } | { ok: false; error: string };

const bool = (v: YesNo): boolean | null => (v === "" ? null : v === "true");
const text = (v: string): string | null => v.trim() || null;

/**
 * Submits this year's health form as a new row — never an edit; a
 * correction is another submission, and the latest in a year is the
 * current one. The emergency contacts also go back onto the profile, where
 * rosters read them (check-in staff need them without the health flag);
 * the form keeps its own copy of what was on file when signed.
 *
 * Only what the checked boxes ask for is stored: a follow-up whose box isn't
 * checked is saved empty, so a stale answer can't linger.
 */
export async function submitHealthHistoryAction(input: HealthHistoryInput): Promise<HealthActionResult> {
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) return { ok: false, error: "Not authenticated" };
  const userId = claims.claims.sub as string;

  const { data: profile } = await supabase.from("profiles").select("chapter").eq("id", userId).maybeSingle();
  const year = healthFormYearFor(profile?.chapter as string | null | undefined);
  const today = new Date().toISOString().slice(0, 10);

  const errors = healthHistoryErrors(input, today);
  if (errors.length > 0) return { ok: false, error: errors[0] };

  const conditions = input.noConditions ? [] : [...new Set(input.conditions)];
  const followUps = followUpsFor(conditions);
  const explain =
    !input.noConditions && (conditionsNeedingExplanation(conditions).length > 0 || input.conditionsOther.trim());
  const carries = input.carriesEpipenOrInhaler === "true";
  const storage = input.medicationStorageNeeded === "true";
  const aid = input.mobilityAidOrFall === "true";

  const contacts = {
    name: input.emergencyContactName.trim(),
    phone: formatPhoneNumber(input.emergencyContactPhone),
    relationship: input.emergencyContactRelationship.trim(),
    name2: input.emergencyContact2Name.trim(),
    phone2: formatPhoneNumber(input.emergencyContact2Phone),
    relationship2: input.emergencyContact2Relationship.trim(),
  };

  // user_id and signed_at are stamped by the database from the session.
  const { error: insertError } = await supabase.from("health_histories").insert({
    user_id: userId,
    year,
    date_of_birth: input.dateOfBirth,
    emergency_contact_name: contacts.name,
    emergency_contact_phone: contacts.phone,
    emergency_contact_relationship: contacts.relationship,
    emergency_contact_2_name: contacts.name2,
    emergency_contact_2_phone: contacts.phone2,
    emergency_contact_2_relationship: contacts.relationship2,
    insurance_carrier: input.insuranceCarrier.trim(),
    insurance_policy_number: input.insurancePolicyNumber.trim(),
    conditions,
    no_conditions: input.noConditions,
    conditions_other: input.noConditions ? null : text(input.conditionsOther),
    cardiac_physician_cleared: followUps.has("cardiac") ? bool(input.cardiacPhysicianCleared) : null,
    cardiac_details: followUps.has("cardiac") ? text(input.cardiacDetails) : null,
    seizure_most_recent: followUps.has("seizure") ? text(input.seizureMostRecent) : null,
    diabetes_uses_insulin: followUps.has("diabetes") ? bool(input.diabetesUsesInsulin) : null,
    diabetes_low_plan: followUps.has("diabetes") ? text(input.diabetesLowPlan) : null,
    surgery_details: followUps.has("surgery") ? text(input.surgeryDetails) : null,
    surgery_physician_cleared: followUps.has("surgery") ? bool(input.surgeryPhysicianCleared) : null,
    sleep_apnea_travels_with_cpap: followUps.has("sleep_apnea") ? bool(input.sleepApneaTravelsWithCpap) : null,
    conditions_explanation: explain ? text(input.conditionsExplanation) : null,
    medications: input.medications.trim(),
    on_blood_thinners: input.onBloodThinners === "true",
    carries_epipen_or_inhaler: carries,
    will_bring_epipen_or_inhaler: carries ? bool(input.willBringEpipenOrInhaler) : null,
    medication_storage_needed: storage,
    medication_storage_details: storage ? text(input.medicationStorageDetails) : null,
    medical_allergies: input.medicalAllergies.trim(),
    walk_uneven_ground: input.walkUnevenGround,
    stand_in_moving_water: input.standInMovingWater,
    recover_footing: input.recoverFooting,
    mobility_aid_or_fall: aid,
    mobility_aid_details: aid ? text(input.mobilityAidDetails) : null,
    swimming: input.swimming,
    anything_else: text(input.anythingElse),
    consent_emergency_treatment: input.consentEmergencyTreatment,
    consent_share_with_ems: input.consentShareWithEms,
    signed_name: input.signedName.trim(),
  });
  if (insertError) {
    console.error(`[health history] submit for ${userId}: ${insertError.code} ${insertError.message}`);
    return {
      ok: false,
      error: "Your health form couldn't be saved. Nothing you entered was lost — try again, and if it keeps happening, contact us.",
    };
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      emergency_contact: contacts.name,
      emergency_phone: contacts.phone,
      emergency_contact_relationship: contacts.relationship,
      emergency_contact_2: contacts.name2,
      emergency_phone_2: contacts.phone2,
      emergency_contact_2_relationship: contacts.relationship2,
    })
    .eq("id", userId);
  if (profileError) {
    // The form itself is saved; the profile copy is a convenience.
    console.error(`[health history] updating emergency contacts for ${userId}: ${profileError.message}`);
  }
  return { ok: true };
}

/**
 * Check-in: "Anything changed since you filled out your health form?" —
 * recorded by whoever checks the person in (any manager of the event). A
 * "yes" flags their form for follow-up, visible only to people who pass the
 * health check; the checker only ever learns that it was answered.
 */
export async function recordHealthCheckinAnswerAction(
  eventId: number,
  userId: string,
  somethingChanged: boolean,
): Promise<HealthActionResult> {
  const supabase = await createClient();
  const gate = await requireEventManager(supabase, eventId);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { error } = await supabase.from("health_checkin_answers").insert({
    event_id: eventId,
    user_id: userId,
    something_changed: somethingChanged,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
