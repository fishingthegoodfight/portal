/**
 * The health history form (table `health_histories` — see the 2026-09-25
 * "Health history form" entry in schema-changes.sql): its questions, the
 * condition catalog, the follow-up rules, and validation. Plain data, safe to
 * import from client components. Reads and access checks live in
 * lib/health-access.ts; nothing here touches the database.
 *
 * No mental health, substance use or counseling questions — that's handled
 * separately, outside this form and outside this system.
 */

export const HEALTH_FORM_INTRO =
  "We ask this so we can plan the right support and keep you safe. Disclosing a condition doesn't disqualify you from a retreat — not disclosing one is what puts you and the guys around you at risk. Only trained staff see this.";

export const MOBILITY_INTRO =
  "These help us plan support. Answer for how you are now, not how you'd like to be.";

export type HealthCondition = { key: string; label: string };
export type HealthConditionGroup = { title: string; conditions: HealthCondition[] };

export const HEALTH_CONDITION_GROUPS: HealthConditionGroup[] = [
  {
    title: "Cardiovascular",
    conditions: [
      { key: "heart_condition", label: "Heart condition, heart attack, or heart surgery" },
      { key: "high_blood_pressure", label: "High blood pressure" },
      { key: "exertion_chest_pain", label: "Chest pain or shortness of breath with exertion" },
      { key: "stroke_tia", label: "Stroke or TIA" },
      { key: "blood_clots", label: "Blood clots, DVT, or pulmonary embolism" },
    ],
  },
  {
    title: "Neurological",
    conditions: [
      { key: "seizures", label: "Seizures or epilepsy" },
      { key: "fainting", label: "Fainting or dizzy spells" },
      { key: "concussion_tbi", label: "Concussion or TBI" },
      { key: "vertigo_balance", label: "Vertigo, balance, or inner-ear problems" },
    ],
  },
  {
    title: "Respiratory",
    conditions: [
      { key: "lung_condition", label: "Asthma, COPD, or other lung condition" },
      { key: "sleep_apnea", label: "Sleep apnea (CPAP)" },
    ],
  },
  {
    title: "Metabolic",
    conditions: [{ key: "diabetes", label: "Diabetes" }],
  },
  {
    title: "Musculoskeletal",
    conditions: [
      { key: "limiting_joint_problems", label: "Back, neck, knee, or joint problems that limit walking or standing" },
      { key: "joint_replacement", label: "Joint replacement or prosthesis" },
      { key: "recent_surgery_injury", label: "Surgery or significant injury in the past 12 months" },
    ],
  },
  {
    title: "Other",
    conditions: [
      { key: "severe_allergy_epinephrine", label: "Severe allergy requiring epinephrine" },
      { key: "bleeding_disorder", label: "Bleeding disorder" },
      { key: "heat_intolerance", label: "Heat illness or heat intolerance" },
      { key: "cold_intolerance", label: "Cold intolerance, Raynaud's, or prior cold injury" },
      { key: "vision_hearing", label: "Vision or hearing impairment that affects safety" },
    ],
  },
];

export const ALL_CONDITIONS: HealthCondition[] = HEALTH_CONDITION_GROUPS.flatMap((g) => g.conditions);
const CONDITION_KEYS = new Set(ALL_CONDITIONS.map((c) => c.key));
const CARDIOVASCULAR_KEYS = new Set(HEALTH_CONDITION_GROUPS[0].conditions.map((c) => c.key));

export function conditionLabel(key: string): string {
  return ALL_CONDITIONS.find((c) => c.key === key)?.label ?? key;
}

/** Which targeted follow-up a checked condition gets. Cardiac covers every
 * cardiovascular box; anything without its own follow-up shares the one
 * "please explain" box. */
export type FollowUp = "cardiac" | "seizure" | "diabetes" | "surgery" | "sleep_apnea";

function followUpFor(key: string): FollowUp | null {
  if (CARDIOVASCULAR_KEYS.has(key)) return "cardiac";
  if (key === "seizures") return "seizure";
  if (key === "diabetes") return "diabetes";
  if (key === "recent_surgery_injury") return "surgery";
  if (key === "sleep_apnea") return "sleep_apnea";
  return null;
}

export function followUpsFor(conditions: string[]): Set<FollowUp> {
  return new Set(conditions.map(followUpFor).filter((f): f is FollowUp => f != null));
}

/** Checked conditions with no targeted follow-up — they share "please explain". */
export function conditionsNeedingExplanation(conditions: string[]): string[] {
  return conditions.filter((key) => followUpFor(key) == null);
}

export const ABILITY_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "with_help", label: "Yes, with some help" },
  { value: "no", label: "No" },
] as const;
export type Ability = (typeof ABILITY_OPTIONS)[number]["value"];

export const SWIMMING_OPTIONS = [
  { value: "confident", label: "I can swim and I'm confident in moving water" },
  { value: "not_confident", label: "I can swim but I'm not confident in moving water" },
  { value: "cannot_swim", label: "I cannot swim" },
] as const;
export type Swimming = (typeof SWIMMING_OPTIONS)[number]["value"];

export const MOBILITY_QUESTIONS = [
  {
    key: "walkUnevenGround",
    label: "Can you walk 30 minutes over uneven, rocky ground while carrying your own gear?",
  },
  {
    key: "standInMovingWater",
    label: "Can you stand and move in knee-to-thigh-deep moving water for extended periods?",
  },
  {
    key: "recoverFooting",
    label: "If you lost your footing in the river, could you get back up without assistance?",
  },
] as const;

export const CONSENT_EMERGENCY_TREATMENT =
  "I authorize Fishing the Good Fight staff to seek emergency medical treatment on my behalf if I'm unable to do so myself.";
export const CONSENT_SHARE_WITH_EMS =
  "I authorize Fishing the Good Fight staff to share this form with EMS or a treating medical facility in an emergency.";

/** "true" / "false" / "" (unanswered) — the form's yes/no state. */
export type YesNo = "true" | "false" | "";

/** What the form holds while it's being filled in. */
export type HealthHistoryInput = {
  dateOfBirth: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  emergencyContact2Name: string;
  emergencyContact2Phone: string;
  emergencyContact2Relationship: string;
  insuranceCarrier: string;
  insurancePolicyNumber: string;
  conditions: string[];
  noConditions: boolean;
  conditionsOther: string;
  cardiacPhysicianCleared: YesNo;
  cardiacDetails: string;
  seizureMostRecent: string;
  diabetesUsesInsulin: YesNo;
  diabetesLowPlan: string;
  surgeryDetails: string;
  surgeryPhysicianCleared: YesNo;
  sleepApneaTravelsWithCpap: YesNo;
  conditionsExplanation: string;
  medications: string;
  onBloodThinners: YesNo;
  carriesEpipenOrInhaler: YesNo;
  willBringEpipenOrInhaler: YesNo;
  medicationStorageNeeded: YesNo;
  medicationStorageDetails: string;
  medicalAllergies: string;
  walkUnevenGround: Ability | "";
  standInMovingWater: Ability | "";
  recoverFooting: Ability | "";
  mobilityAidOrFall: YesNo;
  mobilityAidDetails: string;
  swimming: Swimming | "";
  anythingElse: string;
  consentEmergencyTreatment: boolean;
  consentShareWithEms: boolean;
  signedName: string;
};

export const EMPTY_HEALTH_HISTORY: HealthHistoryInput = {
  dateOfBirth: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelationship: "",
  emergencyContact2Name: "",
  emergencyContact2Phone: "",
  emergencyContact2Relationship: "",
  insuranceCarrier: "",
  insurancePolicyNumber: "",
  conditions: [],
  noConditions: false,
  conditionsOther: "",
  cardiacPhysicianCleared: "",
  cardiacDetails: "",
  seizureMostRecent: "",
  diabetesUsesInsulin: "",
  diabetesLowPlan: "",
  surgeryDetails: "",
  surgeryPhysicianCleared: "",
  sleepApneaTravelsWithCpap: "",
  conditionsExplanation: "",
  medications: "",
  onBloodThinners: "",
  carriesEpipenOrInhaler: "",
  willBringEpipenOrInhaler: "",
  medicationStorageNeeded: "",
  medicationStorageDetails: "",
  medicalAllergies: "",
  walkUnevenGround: "",
  standInMovingWater: "",
  recoverFooting: "",
  mobilityAidOrFall: "",
  mobilityAidDetails: "",
  swimming: "",
  anythingElse: "",
  consentEmergencyTreatment: false,
  consentShareWithEms: false,
  signedName: "",
};

/** Every problem with a submission, in form order — one rule for the form
 * (before submitting) and the server action (before inserting). */
export function healthHistoryErrors(input: HealthHistoryInput, todayIso: string): string[] {
  const errors: string[] = [];
  const blank = (v: string) => !v.trim();
  const unanswered = (v: string) => v === "";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth) || input.dateOfBirth >= todayIso) {
    errors.push("Date of birth is required");
  }
  if (blank(input.emergencyContactName) || blank(input.emergencyContactPhone) || blank(input.emergencyContactRelationship)) {
    errors.push("Emergency contact needs a name, phone and relationship");
  }
  if (blank(input.emergencyContact2Name) || blank(input.emergencyContact2Phone) || blank(input.emergencyContact2Relationship)) {
    errors.push("Second emergency contact needs a name, phone and relationship");
  }
  if (blank(input.insuranceCarrier)) errors.push("Health insurance carrier is required (write None if uninsured)");
  if (blank(input.insurancePolicyNumber)) errors.push("Policy number is required (write N/A if uninsured)");

  if (input.conditions.some((key) => !CONDITION_KEYS.has(key))) errors.push("Unknown condition");
  const anyCondition = input.conditions.length > 0 || !blank(input.conditionsOther);
  if (input.noConditions && anyCondition) {
    errors.push("You checked \"None of the above\" and a condition — uncheck one");
  } else if (!input.noConditions && !anyCondition) {
    errors.push("Check any conditions that apply, or \"None of the above\"");
  }

  const followUps = input.noConditions ? new Set<FollowUp>() : followUpsFor(input.conditions);
  if (followUps.has("cardiac") && unanswered(input.cardiacPhysicianCleared)) {
    errors.push("Answer whether a physician has cleared you for moderate physical activity");
  }
  if (followUps.has("seizure") && blank(input.seizureMostRecent)) {
    errors.push("Give the date of your most recent seizure");
  }
  if (followUps.has("diabetes") && (unanswered(input.diabetesUsesInsulin) || blank(input.diabetesLowPlan))) {
    errors.push("Answer the diabetes questions");
  }
  if (followUps.has("surgery") && (blank(input.surgeryDetails) || unanswered(input.surgeryPhysicianCleared))) {
    errors.push("Tell us about the surgery or injury, and whether a physician has cleared you");
  }
  if (followUps.has("sleep_apnea") && unanswered(input.sleepApneaTravelsWithCpap)) {
    errors.push("Answer whether you travel with a CPAP machine");
  }
  const needsExplanation =
    !input.noConditions &&
    (conditionsNeedingExplanation(input.conditions).length > 0 || !blank(input.conditionsOther));
  if (needsExplanation && blank(input.conditionsExplanation)) {
    errors.push("Please explain the conditions you checked");
  }

  if (blank(input.medications)) errors.push("List your medications and dosages, or write N/A");
  if (unanswered(input.onBloodThinners)) errors.push("Answer whether you're on blood thinners");
  if (unanswered(input.carriesEpipenOrInhaler)) errors.push("Answer whether you carry an EpiPen or rescue inhaler");
  if (input.carriesEpipenOrInhaler === "true" && unanswered(input.willBringEpipenOrInhaler)) {
    errors.push("Answer whether you'll have your EpiPen or inhaler with you at the event");
  }
  if (unanswered(input.medicationStorageNeeded)) {
    errors.push("Answer whether any medication needs refrigeration or secure storage");
  }
  if (input.medicationStorageNeeded === "true" && blank(input.medicationStorageDetails)) {
    errors.push("Tell us which medication needs refrigeration or secure storage");
  }
  if (blank(input.medicalAllergies)) errors.push("List medical allergies, or write None");

  for (const q of MOBILITY_QUESTIONS) {
    if (unanswered(input[q.key])) {
      errors.push("Answer every question under Getting around on the water");
      break;
    }
  }
  if (unanswered(input.mobilityAidOrFall)) {
    errors.push("Answer whether you use a mobility aid or have had a fall in the past year");
  } else if (input.mobilityAidOrFall === "true" && blank(input.mobilityAidDetails)) {
    errors.push("Tell us about the mobility aid or fall");
  }
  if (unanswered(input.swimming)) errors.push("Answer the swimming question");

  if (!input.consentEmergencyTreatment || !input.consentShareWithEms) {
    errors.push("Both consent boxes must be checked to submit");
  }
  if (blank(input.signedName)) errors.push("Type your full name to sign");
  return errors;
}

/** A stored submission, as the health_histories row. */
export type HealthHistoryRecord = {
  id: number;
  user_id: string;
  year: number;
  signed_at: string;
  date_of_birth: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  emergency_contact_2_name: string;
  emergency_contact_2_phone: string;
  emergency_contact_2_relationship: string;
  insurance_carrier: string;
  insurance_policy_number: string;
  conditions: string[];
  no_conditions: boolean;
  conditions_other: string | null;
  cardiac_physician_cleared: boolean | null;
  cardiac_details: string | null;
  seizure_most_recent: string | null;
  diabetes_uses_insulin: boolean | null;
  diabetes_low_plan: string | null;
  surgery_details: string | null;
  surgery_physician_cleared: boolean | null;
  sleep_apnea_travels_with_cpap: boolean | null;
  conditions_explanation: string | null;
  medications: string;
  on_blood_thinners: boolean;
  carries_epipen_or_inhaler: boolean;
  will_bring_epipen_or_inhaler: boolean | null;
  medication_storage_needed: boolean;
  medication_storage_details: string | null;
  medical_allergies: string;
  walk_uneven_ground: Ability;
  stand_in_moving_water: Ability;
  recover_footing: Ability;
  mobility_aid_or_fall: boolean;
  mobility_aid_details: string | null;
  swimming: Swimming;
  anything_else: string | null;
  consent_emergency_treatment: boolean;
  consent_share_with_ems: boolean;
  signed_name: string;
  needs_review: boolean;
};

export function abilityLabel(value: string): string {
  return ABILITY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function swimmingLabel(value: string): string {
  return SWIMMING_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
