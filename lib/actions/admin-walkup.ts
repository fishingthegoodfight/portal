"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { CHAPTERS, NOT_LOCAL_CHAPTER } from "@/lib/chapters";
import { waiverInfoForUser } from "@/lib/waivers";
import {
  collectSectionUpdates,
  columnValuesFromProfile,
  dietaryNoteForRsvp,
  firstIncompleteSection,
  isSectionComplete,
  profileValueFromColumn,
  REGISTRATION_SECTIONS,
  sectionsForEvent,
} from "@/lib/registration-sections";

export type WalkupResult =
  | { ok: true; status: "confirmed"; wasExistingProfile: boolean }
  | { ok: true; status: "capacity_exceeded" }
  | { ok: false; error: string };

/**
 * Adds a confirmed, checked-in "walk-up" RSVP. If the email matches an
 * existing profile, links to it; otherwise creates one.
 *
 * Creating a profile from scratch needs a real auth user first — profiles.id
 * is expected to reference auth.users(id) (see the signup-trigger comment in
 * components/profile-form.tsx), and plain SQL/RLS can't create auth users —
 * so that step goes through the Supabase Admin API (service role key) here,
 * before handing off to the admin_upsert_walkup_rsvp RPC for the actual
 * capacity claim + RSVP write.
 *
 * force=false against a full event returns "capacity_exceeded" without
 * writing anything (including any profile/user just created — a second call
 * with the same email finds that profile and links to it instead of
 * duplicating it); the caller re-submits with force=true once the admin
 * confirms adding them over capacity.
 */
export async function addWalkupRsvpAction(input: {
  eventId: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  directoryOptIn: boolean;
  /** Their home chapter, or "" if not given at the desk — optional, same as
   * on the profile page. Only ever filled in when the profile doesn't
   * already have one on file (see below), never overwritten. */
  chapter?: string;
  /** Typed at the check-in table when the event has a waiver they haven't
   * signed yet; ignored when they already have a valid signature. */
  waiverName?: string;
  waiverAgreed?: boolean;
  /** Answers to the event's registration sections (dietary, sizing, …),
   * keyed by profile column — the same values the RSVP form collects. */
  sections?: Record<string, string>;
  force: boolean;
}): Promise<WalkupResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  const emergencyContactName = input.emergencyContactName.trim();
  const emergencyContactPhone = input.emergencyContactPhone.trim();
  // Optional and picked from a closed dropdown — a value outside that set
  // (a hand-rolled request) is silently dropped rather than rejected, same
  // as leaving the field blank.
  const chapter =
    input.chapter && (CHAPTERS.some((c) => c.name === input.chapter) || input.chapter === NOT_LOCAL_CHAPTER)
      ? input.chapter
      : null;

  if (!firstName || !lastName) return { ok: false, error: "Name is required" };
  if (!email) return { ok: false, error: "Email is required" };
  if (!phone) return { ok: false, error: "Phone is required" };
  if (!emergencyContactName || !emergencyContactPhone) {
    return { ok: false, error: "Emergency contact name and phone are required" };
  }

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("*")
    .ilike("email", email)
    .maybeSingle();

  // What the profile already has for every catalog field (empty for someone
  // with no profile yet) — sections complete here are skipped, exactly as on
  // the RSVP form.
  const onFile: Record<string, string> = {};
  for (const section of REGISTRATION_SECTIONS) {
    for (const field of section.fields) {
      onFile[field.key] = profileValueFromColumn(field, existingProfile?.[field.key]);
    }
  }

  // Walk-ups must sign the event's waiver too. Decided before anything is
  // created, so a missing signature can't leave a half-added profile behind.
  let waiverIdToSign: number | null = null;
  const { data: waiverEvent } = await supabase
    .from("events")
    .select("chapter, waiver_state, starts_at, timezone, registration_sections")
    .eq("id", input.eventId)
    .maybeSingle();
  if (waiverEvent) {
    const info = await waiverInfoForUser(
      supabase,
      waiverEvent,
      (existingProfile?.id as string | undefined) ?? null,
    );
    if (info.status === "unavailable") {
      return { ok: false, error: info.message };
    }
    if (info.status === "unsigned") {
      if (!input.waiverAgreed || !(input.waiverName ?? "").trim()) {
        return {
          ok: false,
          error: "The waiver must be agreed to and signed with a typed full name.",
        };
      }
      waiverIdToSign = info.waiverId;
    }
  }

  // The event's own registration sections (dietary, sizing, …) — the
  // emergency contact and directory choice are collected above, and the
  // waiver is handled separately. Validated and saved with the same shared
  // helpers as the RSVP form. Server-side, so only the event's own sections'
  // columns can ever be written, whatever the client sends.
  const eventSections = sectionsForEvent(waiverEvent?.registration_sections).filter(
    (section) => !section.alwaysRequired && section.kind !== "waiver",
  );
  const sectionValues: Record<string, string> = { ...onFile };
  for (const section of eventSections) {
    if (!section.alwaysEditable && isSectionComplete(section, onFile)) continue;
    for (const field of section.fields) {
      sectionValues[field.key] = input.sections?.[field.key] ?? onFile[field.key] ?? "";
    }
  }
  const incompleteSection = firstIncompleteSection(eventSections, sectionValues);
  if (incompleteSection) {
    return { ok: false, error: `Complete "${incompleteSection.title}" for the walk-up.` };
  }
  const sectionUpdates = collectSectionUpdates(eventSections, onFile, sectionValues);

  let profileId: string;
  let wasExistingProfile: boolean;

  if (existingProfile) {
    profileId = existingProfile.id as string;
    wasExistingProfile = true;

    // Same rule the RSVP form follows: an already-complete field is left
    // alone rather than overwritten with what was typed at the walk-up desk.
    const hasEmergencyContactOnFile = Boolean(
      (existingProfile.emergency_contact as string | null)?.trim() &&
      (existingProfile.emergency_phone as string | null)?.trim(),
    );
    const hasChapterOnFile = Boolean((existingProfile.chapter as string | null)?.trim());
    const fillIn: Record<string, string> = {};
    if (!hasEmergencyContactOnFile) {
      fillIn.emergency_contact = emergencyContactName;
      fillIn.emergency_phone = emergencyContactPhone;
    }
    if (!hasChapterOnFile && chapter) fillIn.chapter = chapter;

    if (Object.keys(fillIn).length > 0) {
      let adminClient: ReturnType<typeof createAdminClient>;
      try {
        adminClient = createAdminClient();
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Admin client unavailable",
        };
      }
      // Admins only have SELECT on other members' profiles (see the
      // admin_select_all_profiles RLS policy) — writing to someone else's
      // row goes through the service-role client, same as profile creation
      // below.
      const { error: updateError } = await adminClient
        .from("profiles")
        .update(fillIn)
        .eq("id", profileId);
      if (updateError) {
        return { ok: false, error: updateError.message };
      }
    }
  } else {
    let adminClient: ReturnType<typeof createAdminClient>;
    try {
      adminClient = createAdminClient();
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Admin client unavailable",
      };
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    });
    if (createError || !created?.user) {
      return { ok: false, error: createError?.message ?? "Failed to create profile" };
    }
    profileId = created.user.id;
    wasExistingProfile = false;

    // The signup trigger inserts the profiles row as part of creating the
    // auth user above; fill in what the walk-up form collected — including
    // emergency contact, same as the RSVP form saves it to the profile so
    // it's on file next time.
    const { error: updateError } = await adminClient
      .from("profiles")
      .update({
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        emergency_contact: emergencyContactName,
        emergency_phone: emergencyContactPhone,
        chapter,
        directory_opt_in: input.directoryOptIn,
        ...columnValuesFromProfile(sectionUpdates),
      })
      .eq("id", profileId);
    if (updateError) {
      return { ok: false, error: updateError.message };
    }
  }

  if (wasExistingProfile && Object.keys(sectionUpdates).length > 0) {
    // Admins can only SELECT other members' profiles, so this goes through
    // the service-role client, same as the emergency-contact fill-in above.
    let adminClient: ReturnType<typeof createAdminClient>;
    try {
      adminClient = createAdminClient();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Admin client unavailable" };
    }
    const { error: sectionError } = await adminClient
      .from("profiles")
      .update(columnValuesFromProfile(sectionUpdates))
      .eq("id", profileId);
    if (sectionError) {
      console.error(
        `[walkup] event ${input.eventId}: saving registration sections failed:`,
        sectionError,
      );
      return { ok: false, error: sectionError.message };
    }
  }

  if (waiverIdToSign != null) {
    // Recorded for the walk-up (not the admin), so it goes through the
    // service-role client — RLS only lets people sign for themselves. The
    // unique (user, waiver) key makes a retry after "capacity exceeded" a
    // no-op instead of a duplicate.
    let adminClient: ReturnType<typeof createAdminClient>;
    try {
      adminClient = createAdminClient();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Admin client unavailable" };
    }
    const { error: signError } = await adminClient.from("waiver_signatures").upsert(
      {
        user_id: profileId,
        waiver_id: waiverIdToSign,
        signed_name: (input.waiverName ?? "").trim(),
      },
      { onConflict: "user_id,waiver_id", ignoreDuplicates: true },
    );
    if (signError) {
      console.error(
        `[walkup] event ${input.eventId}: recording waiver signature failed:`,
        signError,
      );
      return { ok: false, error: `Couldn't record the waiver signature: ${signError.message}` };
    }
  }

  const { data: status, error: rpcError } = await supabase.rpc("admin_upsert_walkup_rsvp", {
    p_event_id: input.eventId,
    p_profile_id: profileId,
    p_force: input.force,
  });
  if (rpcError) return { ok: false, error: rpcError.message };

  if (status === "capacity_exceeded") {
    return { ok: true, status: "capacity_exceeded" };
  }

  // The RSVP row carries the free-text dietary note organizers see on the
  // roster — same rule as the RSVP form: an explicit "No" is just no note.
  if (eventSections.some((section) => section.id === "dietary")) {
    const dietary = dietaryNoteForRsvp(eventSections, onFile, sectionUpdates);
    try {
      const { error: dietaryError } = await createAdminClient()
        .from("rsvps")
        .update({ dietary_notes: dietary })
        .eq("event_id", input.eventId)
        .eq("user_id", profileId);
      if (dietaryError) throw dietaryError;
    } catch (err) {
      console.error(`[walkup] event ${input.eventId}: saving dietary note failed:`, err);
      return {
        ok: false,
        error: "Added, but couldn't save the dietary note — please re-check it.",
      };
    }
  }

  return { ok: true, status: "confirmed", wasExistingProfile };
}
