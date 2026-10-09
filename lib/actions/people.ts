"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { isChapterName, loadChapters, NOT_LOCAL_CHAPTER } from "@/lib/chapters";
import { formatPhoneNumber, formatPostalCode } from "@/lib/phone";
import {
  columnValuesFromProfile,
  isFieldVisible,
  REGISTRATION_SECTIONS,
  withHiddenFieldsCleared,
} from "@/lib/registration-sections";
import { US_STATE_NAMES } from "@/lib/us-states";

export type PeopleActionResult = { ok: true } | { ok: false; error: string };

export type ContactDetailsInput = {
  first_name: string;
  last_name: string;
  phone: string;
  chapter: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
};

const clean = (value: string) => value.trim().replace(/\s+/g, " ");

/**
 * Admins, from the contact profile (/protected/admin/people/[id]): saves
 * someone's contact details. Not the email: that's their login, which only
 * changes with the auth account (see CLAUDE.md, profiles.email).
 *
 * RLS only lets people update their own profile, so the write goes through
 * the service-role client after the admin check, the same as the roster's
 * Edit details (roster-person.ts).
 */
export async function saveContactDetailsAction(
  userId: string,
  input: ContactDetailsInput,
): Promise<PeopleActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const firstName = clean(input.first_name);
  const lastName = clean(input.last_name);
  if (!firstName || !lastName) return { ok: false, error: "First and last name are both required" };
  const phone = formatPhoneNumber(input.phone);
  if (phone && phone.replace(/\D/g, "").length !== 10) {
    return { ok: false, error: "Enter the full 10-digit phone number" };
  }
  const chapter = input.chapter.trim();
  if (chapter && chapter !== NOT_LOCAL_CHAPTER && !isChapterName(await loadChapters(supabase), chapter)) {
    return { ok: false, error: "That isn't a chapter" };
  }
  const state = input.state.trim();
  if (state && !(state in US_STATE_NAMES)) return { ok: false, error: "Choose a state" };

  return updateProfile(userId, {
    first_name: firstName,
    last_name: lastName,
    phone,
    chapter: chapter || null,
    address_line1: clean(input.address_line1),
    address_line2: clean(input.address_line2),
    city: clean(input.city),
    state,
    postal_code: formatPostalCode(input.postal_code),
  });
}

/**
 * Admins, from the contact profile: saves one registration section (the
 * emergency contacts, dietary, sizing, …) with the same rules as the
 * profile page. Only that section's columns are written.
 */
export async function saveProfileSectionAction(
  userId: string,
  sectionId: string,
  values: Record<string, string>,
): Promise<PeopleActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const section = REGISTRATION_SECTIONS.find((s) => s.id === sectionId);
  if (!section || section.kind === "waiver") return { ok: false, error: "Unknown section" };

  const own = Object.fromEntries(section.fields.map((f) => [f.key, (values[f.key] ?? "").trim()]));
  const problem = section.problem?.(own);
  if (problem) return { ok: false, error: problem };
  // A required section (the emergency contact) can't be cleared out.
  if (section.alwaysRequired) {
    const missing = section.fields.find((f) => f.required && isFieldVisible(f, own) && !own[f.key]);
    if (missing) return { ok: false, error: `${missing.label} is required` };
  }

  // withHiddenFieldsCleared walks every section, so keep only this one's
  // columns: another section's conditional fields would read as hidden here.
  const cleared = withHiddenFieldsCleared(own);
  const update = columnValuesFromProfile(Object.fromEntries(section.fields.map((f) => [f.key, cleared[f.key] ?? ""])));
  return updateProfile(userId, update);
}

async function updateProfile(userId: string, update: Record<string, unknown>): Promise<PeopleActionResult> {
  let adminClient: ReturnType<typeof createAdminClient>;
  try {
    adminClient = createAdminClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Admin client unavailable" };
  }
  const { data, error } = await adminClient.from("profiles").update(update).eq("id", userId).select("id").maybeSingle();
  if (error) {
    console.error(`[people] updating ${userId} failed:`, error);
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: "No profile found for this person" };
  return { ok: true };
}
