"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";

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

  if (!firstName || !lastName) return { ok: false, error: "Name is required" };
  if (!email) return { ok: false, error: "Email is required" };
  if (!phone) return { ok: false, error: "Phone is required" };
  if (!emergencyContactName || !emergencyContactPhone) {
    return { ok: false, error: "Emergency contact name and phone are required" };
  }

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id, emergency_contact, emergency_phone")
    .ilike("email", email)
    .maybeSingle();

  let profileId: string;
  let wasExistingProfile: boolean;

  if (existingProfile) {
    profileId = existingProfile.id as string;
    wasExistingProfile = true;

    // Same rule the RSVP form follows: an already-complete section is left
    // alone rather than overwritten with what was typed at the walk-up desk.
    const hasEmergencyContactOnFile = Boolean(
      (existingProfile.emergency_contact as string | null)?.trim() &&
        (existingProfile.emergency_phone as string | null)?.trim(),
    );
    if (!hasEmergencyContactOnFile) {
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
        .update({
          emergency_contact: emergencyContactName,
          emergency_phone: emergencyContactPhone,
        })
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
      })
      .eq("id", profileId);
    if (updateError) {
      return { ok: false, error: updateError.message };
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

  return { ok: true, status: "confirmed", wasExistingProfile };
}
