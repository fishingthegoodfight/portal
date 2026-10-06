"use server";

import { createClient } from "@/lib/supabase/server";
import { findProfileByEmail } from "@/lib/profile-lookup";
import { isAfterEvent } from "@/lib/event-timing";
import { missingCoreFields } from "@/lib/core-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignLeadEventsToNewAccount } from "@/lib/admin/lead-account";
import { requireAdmin, requireEventManager } from "@/lib/admin/require-admin";
import { activeChapters, isChapterName, loadChapters, NOT_LOCAL_CHAPTER } from "@/lib/chapters";
import { waiverInfoForUser } from "@/lib/waivers";
import { formatEventDateRange } from "@/lib/format-date";
import { confirmedShiftsAtEvent } from "@/lib/volunteer-signups";
import {
  collectSectionUpdates,
  columnValuesFromProfile,
  dietaryNoteForRsvp,
  firstIncompleteSection,
  incompleteSectionMessage,
  secondContactProblem,
  isSectionComplete,
  profileValueFromColumn,
  REGISTRATION_SECTIONS,
  sectionsForEvent,
} from "@/lib/registration-sections";

export type WalkupResult =
  | { ok: true; status: "confirmed"; wasExistingProfile: boolean }
  | { ok: true; status: "capacity_exceeded" }
  /** They're signed up to volunteer at this event ("Role, time" per shift).
   * Someone can't normally be both — adding them anyway is the admin's call
   * (allowVolunteerConflict), and leaves the shifts in place. */
  | { ok: true; status: "volunteer_conflict"; shifts: string[] }
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
type WalkupInput = {
  eventId: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  /** Optional, as on the RSVP form — as is the whole second contact. */
  emergencyContactRelationship?: string;
  emergencyContact2Name?: string;
  emergencyContact2Phone?: string;
  emergencyContact2Relationship?: string;
  directoryOptIn: boolean;
  /** Their home chapter, or "" if not given at the desk — optional, same as
   * on the profile page. Only ever filled in when the profile doesn't
   * already have one on file (see below), never overwritten. */
  chapter?: string;
  /** Typed at the check-in table when the event has a waiver they haven't
   * signed yet; ignored when they already have a valid signature. */
  waiverName?: string;
  waiverAgreed?: boolean;
  /** The fallback for when signing here fails: the lead confirms they hold
   * this person's signed PAPER waiver. Recorded for this event only
   * (event_paper_waivers) — no signature is created, so they're asked to
   * sign in the portal at their next event. Ignored when they already have
   * a valid signature. */
  paperWaiverHeld?: boolean;
  /** Only once the event has ended (when signing here is no longer
   * offered): record their attendance with no waiver at all
   * (event_no_waiver_records). Flagged on the roster and in the digest; it
   * isn't a signature and satisfies nothing else. Ignored when they already
   * have a valid signature or a paper waiver is being recorded. */
  noWaiverOnFile?: boolean;
  /** Answers to the event's registration sections (dietary, sizing, …),
   * keyed by profile column — the same values the RSVP form collects. */
  sections?: Record<string, string>;
  /** Set once the admin has seen the volunteer_conflict warning. */
  allowVolunteerConflict?: boolean;
  force: boolean;
};

export async function addWalkupRsvpAction(input: WalkupInput): Promise<WalkupResult> {
  return addWalkup(input, false);
}

/** isRetry: this is the one re-run after createUser found the email already
 * taken (see below), so it can't loop. */
async function addWalkup(input: WalkupInput, isRetry: boolean): Promise<WalkupResult> {
  const supabase = await createClient();
  const adminCheck = await requireEventManager(supabase, input.eventId);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  // Everything about the walk-up PERSON (do they have a profile, have they
  // signed this waiver, are they volunteering here) is looked up with the
  // service-role client: a chapter lead can only read the profiles of people
  // already on their events, and a walk-up usually isn't yet. The gate above
  // (can_manage_event) is what authorizes this; the final write still goes
  // through admin_upsert_walkup_rsvp as the caller, which re-checks it.
  let lookup: ReturnType<typeof createAdminClient>;
  try {
    lookup = createAdminClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Admin client unavailable" };
  }

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  const emergencyContactName = input.emergencyContactName.trim();
  const emergencyContactPhone = input.emergencyContactPhone.trim();
  const emergencyContactRelationship = input.emergencyContactRelationship?.trim() ?? "";
  const secondContact = {
    name: input.emergencyContact2Name?.trim() ?? "",
    phone: input.emergencyContact2Phone?.trim() ?? "",
    relationship: input.emergencyContact2Relationship?.trim() ?? "",
  };
  // Optional and picked from a closed dropdown — a value outside that set
  // (a hand-rolled request) is silently dropped rather than rejected, same
  // as leaving the field blank.
  const chapter =
    input.chapter &&
    (isChapterName(activeChapters(await loadChapters(supabase)), input.chapter) ||
      input.chapter === NOT_LOCAL_CHAPTER)
      ? input.chapter
      : null;

  if (!email) return { ok: false, error: "Email is required" };
  const secondContactError = secondContactProblem(secondContact.name, secondContact.phone);
  if (secondContactError) return { ok: false, error: secondContactError };

  const existingProfile = await findProfileByEmail(lookup, email);

  // The core profile (lib/core-profile.ts) is required, but only what isn't
  // on file: someone already in the system is asked for nothing they've
  // given before (the form hides those fields), and someone new for all of
  // it. What's typed only ever fills blanks (below).
  const missingCore = new Set(missingCoreFields(existingProfile));
  if ((missingCore.has("first_name") && !firstName) || (missingCore.has("last_name") && !lastName)) {
    return { ok: false, error: "Name is required" };
  }
  if (missingCore.has("phone") && !phone) return { ok: false, error: "Phone is required" };
  if (
    (missingCore.has("emergency_contact") || missingCore.has("emergency_phone")) &&
    (!emergencyContactName || !emergencyContactPhone)
  ) {
    return { ok: false, error: "Emergency contact name and phone are required" };
  }
  if (missingCore.has("chapter") && !chapter) return { ok: false, error: "Choose their home chapter" };

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
  let paperWaiver = false;
  let noWaiver = false;
  const { data: waiverEvent } = await supabase
    .from("events")
    .select("id, chapter, waiver_state, starts_at, ends_at, timezone, registration_sections")
    .eq("id", input.eventId)
    .maybeSingle();
  if (waiverEvent) {
    const info = await waiverInfoForUser(
      lookup,
      waiverEvent,
      (existingProfile?.id as string | undefined) ?? null,
    );
    if (info.status === "unavailable") {
      return { ok: false, error: info.message };
    }
    // Once the event has ended the person usually isn't there, and a
    // signature typed then would count as their waiver for the whole year:
    // no signing here. A paper waiver the lead holds, or "No waiver on
    // file" (admin_upsert_walkup_rsvp re-checks that the event has ended).
    const ended = isAfterEvent(new Date().toISOString(), {
      startsAt: waiverEvent.starts_at as string,
      endsAt: (waiverEvent.ends_at as string | null) ?? null,
      timeZone: waiverEvent.timezone as string,
    });
    if (info.status === "unsigned" && input.paperWaiverHeld) {
      paperWaiver = true;
    } else if (info.status === "unsigned" && ended) {
      if (!input.noWaiverOnFile) {
        return {
          ok: false,
          error:
            "This event has ended, so they can't sign in the portal for it now. Record the paper waiver you hold, or No waiver on file.",
        };
      }
      noWaiver = true;
    } else if (info.status === "unsigned") {
      if (!input.waiverAgreed || !(input.waiverName ?? "").trim()) {
        return {
          ok: false,
          error: "The waiver must be agreed to and signed with a typed full name.",
        };
      }
      waiverIdToSign = info.waiverId;
    }
  }

  // Attend or volunteer, not both — but at the check-in table that's the
  // admin's call, so it's a warning to confirm, not a block. Checked before
  // anything is written, like the waiver above.
  if (existingProfile && waiverEvent && !input.allowVolunteerConflict) {
    const shifts = await confirmedShiftsAtEvent(lookup, existingProfile.id as string, input.eventId);
    if (shifts.length > 0) {
      return {
        ok: true,
        status: "volunteer_conflict",
        shifts: shifts.map(
          (s) => `${s.role}, ${formatEventDateRange(s.shiftStart, s.shiftEnd, waiverEvent.timezone)}`,
        ),
      };
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
    return { ok: false, error: incompleteSectionMessage(incompleteSection, sectionValues, " for the walk-up.") };
  }
  const sectionUpdates = collectSectionUpdates(eventSections, onFile, sectionValues);

  let profileId: string;
  let wasExistingProfile: boolean;

  if (existingProfile) {
    profileId = existingProfile.id as string;
    wasExistingProfile = true;

    // Same rule the RSVP form follows: an already-complete field is left
    // alone rather than overwritten with what was typed at the walk-up desk.
    // Each contact is filled as a whole or not at all, so a relationship
    // typed at the desk never gets attached to a different person on file.
    const onFileText = (column: string) => ((existingProfile[column] as string | null) ?? "").trim();
    const hasEmergencyContactOnFile = Boolean(onFileText("emergency_contact") && onFileText("emergency_phone"));
    const hasSecondContactOnFile = Boolean(onFileText("emergency_contact_2") || onFileText("emergency_phone_2"));
    const hasChapterOnFile = Boolean(onFileText("chapter"));
    const fillIn: Record<string, string | null> = {};
    // Name and phone too: an account made at sign-up before those were
    // asked has neither, and would otherwise stay an email on the roster.
    if (!onFileText("first_name")) fillIn.first_name = firstName;
    if (!onFileText("last_name")) fillIn.last_name = lastName;
    if (!onFileText("phone")) fillIn.phone = phone;
    if (!hasEmergencyContactOnFile) {
      fillIn.emergency_contact = emergencyContactName;
      fillIn.emergency_phone = emergencyContactPhone;
      fillIn.emergency_contact_relationship = emergencyContactRelationship || null;
    }
    if (!hasSecondContactOnFile && secondContact.name) {
      fillIn.emergency_contact_2 = secondContact.name;
      fillIn.emergency_phone_2 = secondContact.phone;
      fillIn.emergency_contact_2_relationship = secondContact.relationship || null;
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
    if (createError?.code === "email_exists" && !isRetry) {
      // The account appeared after the lookup above (another lead adding
      // the same person at the same moment). Run once more: the lookup
      // finds it now and links the walk-up to it.
      return addWalkup(input, true);
    }
    if (createError || !created?.user) {
      return { ok: false, error: createError?.message ?? "Failed to create profile" };
    }
    profileId = created.user.id;
    wasExistingProfile = false;
    await assignLeadEventsToNewAccount(adminClient, profileId);
    // Queue their welcome email (lib/walkup-welcome.ts), sent the morning
    // after the event. Never blocks the walk-up: a failure is logged.
    const { error: welcomeError } = await adminClient
      .from("walkup_welcome_emails")
      .upsert(
        { user_id: profileId, event_id: input.eventId, source: "walkup" },
        { onConflict: "user_id", ignoreDuplicates: true },
      );
    if (welcomeError) {
      console.error(`[walkup] event ${input.eventId}: queueing the welcome email failed:`, welcomeError);
    }

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
        emergency_contact_relationship: emergencyContactRelationship || null,
        emergency_contact_2: secondContact.name || null,
        emergency_phone_2: secondContact.phone || null,
        emergency_contact_2_relationship: (secondContact.name && secondContact.relationship) || null,
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
    // Who recorded it and when are stamped by the function, not sent.
    ...(paperWaiver ? { p_paper_waiver: true } : {}),
    ...(noWaiver ? { p_no_waiver: true } : {}),
  });
  if (rpcError) return { ok: false, error: rpcError.message };

  if (status === "capacity_exceeded") {
    return { ok: true, status: "capacity_exceeded" };
  }
  // admin_upsert_walkup_rsvp re-checks the waiver and sections itself; this
  // action records both first, so these only show if that somehow failed.
  if (status === "waiver_unsigned") {
    return { ok: false, error: "The waiver signature wasn't recorded — have them sign again." };
  }
  if (status === "registration_incomplete") {
    return { ok: false, error: "Their registration answers are incomplete — check every section." };
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

/**
 * Removes a paper waiver record entered by mistake, so the person shows as
 * "waiver not signed" again. Admins only — a chapter lead can record one
 * but not remove it (admin_remove_paper_waiver re-checks). The removal is
 * kept in event_paper_waiver_removals: what the record said, who removed
 * it and when. Their RSVP and check-in are left as they are.
 */
export async function removePaperWaiverAction(
  rsvpId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { data: removed, error } = await supabase.rpc("admin_remove_paper_waiver", {
    p_rsvp_id: rsvpId,
  });
  if (error) {
    console.error(`[paper-waiver] rsvp ${rsvpId}: admin_remove_paper_waiver failed:`, error);
    return { ok: false, error: error.message };
  }
  if (!removed) return { ok: false, error: "That paper waiver record was already removed." };
  return { ok: true };
}
