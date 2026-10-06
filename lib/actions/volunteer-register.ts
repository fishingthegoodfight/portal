"use server";

import { createClient } from "@/lib/supabase/server";
import { isChapterName, loadChapters, NOT_LOCAL_CHAPTER, timezoneForChapter } from "@/lib/chapters";
import { formatPhoneNumber, formatPostalCode } from "@/lib/phone";
import {
  resolveVolunteerWaiver,
  waiverInfoForVolunteer,
  type WaiverInfo,
} from "@/lib/waivers";
import { PROGRAM_INTERESTS, SKILL_INTERESTS, TSHIRT_SIZES } from "@/lib/volunteers";
import { experienceErrors, experienceToRow, type ExperienceInput } from "@/lib/volunteer-applications";

export type WaiverLookupResult = { ok: true; info: WaiverInfo } | { ok: false; error: string };

/** Re-resolves the volunteer waiver as the "home chapter" field changes on
 * the registration form — the waiver depends on the chapter's state, chosen
 * live, so this can't be computed once on page load. */
export async function loadVolunteerWaiverInfoAction(homeChapter: string): Promise<WaiverLookupResult> {
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) return { ok: false, error: "Not authenticated" };
  const userId = claims.claims.sub as string;

  const timezone = timezoneForChapter(homeChapter, await loadChapters(supabase));
  const info = await waiverInfoForVolunteer(supabase, homeChapter, timezone, userId);
  return { ok: true, info };
}

export type SubmitVolunteerRegistrationInput = {
  firstName: string;
  lastName: string;
  cellPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  emergencyContact2Name: string;
  emergencyContact2Phone: string;
  emergencyContact2Relationship: string;
  homeChapter: string;
  tshirtSize: string;
  favoriteSnack: string;
  favoriteNaBeverage: string;
  is18Plus: boolean;
  skillInterests: string[];
  skillInterestsOther: string;
  programInterests: string[];
  /** Fly fishing, certifications, availability — the application's questions. */
  experience: ExperienceInput;
  waiverAgreed: boolean;
  waiverSignedName: string;
  /** Set only when interested in Retreats and a file was uploaded — the
   * upload itself happens client-side (browser Supabase client, straight to
   * the volunteer-certifications bucket, own-folder RLS), this action just
   * records the row. */
  certification?: { filePath: string | null; issuedOn: string; expiresOn: string };
};

export type SubmitVolunteerRegistrationResult = { ok: true } | { ok: false; error: string };

export async function submitVolunteerRegistrationAction(
  input: SubmitVolunteerRegistrationInput,
): Promise<SubmitVolunteerRegistrationResult> {
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) return { ok: false, error: "Not authenticated" };
  const userId = claims.claims.sub as string;

  const { data: volunteer } = await supabase
    .from("volunteers")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!volunteer) {
    return { ok: false, error: "Volunteer registration is by invitation only." };
  }

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const cellPhone = input.cellPhone.trim();
  const addressLine1 = input.addressLine1.trim();
  const city = input.city.trim();
  const state = input.state.trim();
  const postalCode = formatPostalCode(input.postalCode);
  // The profile's two emergency contacts, required in full here as on the
  // health form (which saves to the same columns).
  const contacts = {
    name: input.emergencyContactName.trim(),
    phone: formatPhoneNumber(input.emergencyContactPhone),
    relationship: input.emergencyContactRelationship.trim(),
    name2: input.emergencyContact2Name.trim(),
    phone2: formatPhoneNumber(input.emergencyContact2Phone),
    relationship2: input.emergencyContact2Relationship.trim(),
  };
  const homeChapter = input.homeChapter.trim();
  const tshirtSize = input.tshirtSize.trim();
  const favoriteSnack = input.favoriteSnack.trim();
  const favoriteNaBeverage = input.favoriteNaBeverage.trim();

  if (!firstName || !lastName) return { ok: false, error: "First and last name are required" };
  if (!cellPhone) return { ok: false, error: "Cell phone is required" };
  if (!addressLine1 || !city || !state || !postalCode) {
    return { ok: false, error: "Full address is required" };
  }
  if (!contacts.name || !contacts.phone || !contacts.relationship) {
    return { ok: false, error: "Emergency contact needs a name, phone and relationship" };
  }
  if (!contacts.name2 || !contacts.phone2 || !contacts.relationship2) {
    return { ok: false, error: "Second emergency contact needs a name, phone and relationship" };
  }
  const chapters = await loadChapters(supabase);
  if (!isChapterName(chapters, homeChapter) && homeChapter !== NOT_LOCAL_CHAPTER) {
    return { ok: false, error: "Choose a home chapter" };
  }
  if (!TSHIRT_SIZES.includes(tshirtSize as (typeof TSHIRT_SIZES)[number])) {
    return { ok: false, error: "Choose a t-shirt size" };
  }
  if (!favoriteSnack) return { ok: false, error: "Favorite snack is required" };
  if (!favoriteNaBeverage) return { ok: false, error: "Favorite N/A beverage is required" };
  if (!input.is18Plus) {
    return { ok: false, error: "You must confirm you are 18 years of age or older" };
  }
  const experienceProblems = experienceErrors(input.experience);
  if (experienceProblems.length > 0) return { ok: false, error: experienceProblems[0] };

  // "Other" isn't in SKILL_INTERESTS (it's the form's extra box), so it's
  // allowed through explicitly — filtering it out lost the description.
  const skillInterests = input.skillInterests.filter((s) => s === "Other" || SKILL_INTERESTS.includes(s as never));
  const skillInterestsOther = skillInterests.includes("Other")
    ? input.skillInterestsOther.trim()
    : "";
  if (skillInterests.includes("Other") && !skillInterestsOther) {
    return { ok: false, error: 'Describe your "Other" skill/interest area' };
  }
  const programInterests = input.programInterests.filter((p) =>
    PROGRAM_INTERESTS.includes(p as never),
  );

  const timezone = timezoneForChapter(homeChapter, chapters);
  const requirement = await resolveVolunteerWaiver(supabase, homeChapter, timezone);
  if (requirement.kind !== "ok") {
    return { ok: false, error: "No volunteer waiver is available for your home chapter yet." };
  }
  const { data: existingSignature } = await supabase
    .from("waiver_signatures")
    .select("id")
    .eq("user_id", userId)
    .eq("waiver_id", requirement.waiver.id)
    .maybeSingle();
  // Already signed this exact waiver (e.g. re-submitting to update other
  // answers) — nothing more to collect for it.
  if (!existingSignature && (!input.waiverAgreed || !input.waiverSignedName.trim())) {
    return { ok: false, error: "You must agree to and sign the volunteer waiver." };
  }

  const wantsRetreats = programInterests.includes("Retreats");

  // --- Save, in an order that leaves nothing half-done on a mid-way
  // failure: profile first (pure data), then the signature (immutable,
  // idempotent on conflict), then the optional cert row, then the volunteers
  // row status flip last — so a failure earlier never marks someone
  // "registered" without their answers actually being saved. ---

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      first_name: firstName,
      last_name: lastName,
      phone: cellPhone,
      address_line1: addressLine1,
      address_line2: input.addressLine2.trim() || null,
      city,
      state,
      postal_code: postalCode,
      emergency_contact: contacts.name,
      emergency_phone: contacts.phone,
      emergency_contact_relationship: contacts.relationship,
      emergency_contact_2: contacts.name2,
      emergency_phone_2: contacts.phone2,
      emergency_contact_2_relationship: contacts.relationship2,
      chapter: homeChapter,
      tshirt_size: tshirtSize,
      favorite_snack: favoriteSnack,
      favorite_na_beverage: favoriteNaBeverage,
      skill_interests: skillInterests,
      skill_interests_other: skillInterestsOther || null,
      program_interests: programInterests,
    })
    .eq("id", userId);
  if (profileError) return { ok: false, error: profileError.message };

  // Confirmed afresh at each registration (confirmed_at is stamped by the
  // database) — availability and certifications go stale.
  const { error: detailsError } = await supabase
    .from("volunteer_registration_details")
    .upsert({ volunteer_id: userId, ...experienceToRow(input.experience) }, { onConflict: "volunteer_id" });
  if (detailsError) return { ok: false, error: detailsError.message };

  if (!existingSignature) {
    const { error: signError } = await supabase.from("waiver_signatures").insert({
      user_id: userId,
      waiver_id: requirement.waiver.id,
      signed_name: input.waiverSignedName.trim(),
    });
    // 23505 = signed concurrently (e.g. a double-submit) — fine.
    if (signError && signError.code !== "23505") return { ok: false, error: signError.message };
  }

  if (wantsRetreats && input.certification?.filePath) {
    const { error: certError } = await supabase.from("volunteer_certifications").insert({
      volunteer_id: userId,
      kind: "first_aid_cpr_aed",
      file_path: input.certification.filePath,
      issued_on: input.certification.issuedOn || null,
      expires_on: input.certification.expiresOn || null,
    });
    if (certError) {
      return {
        ok: false,
        error: `Registration was saved, but the certification upload failed to record: ${certError.message}`,
      };
    }
  }

  // Goes through the complete_volunteer_registration RPC, not a plain
  // UPDATE — there's no RLS policy letting a volunteer write their own
  // `volunteers` row directly (see the schema-changes.sql design note),
  // since that would let a client PATCH straight to status='approved'.
  const { error: volunteerError } = await supabase.rpc("complete_volunteer_registration", {
    p_is_18_plus: true,
  });
  if (volunteerError) return { ok: false, error: volunteerError.message };

  return { ok: true };
}
