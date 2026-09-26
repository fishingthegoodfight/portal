"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { VOLUNTEER_STATUSES, type VolunteerStatus } from "@/lib/volunteers";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Admin-only status selector on the volunteer detail page. */
export async function updateVolunteerStatusAction(
  volunteerId: string,
  status: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  if (!VOLUNTEER_STATUSES.includes(status as VolunteerStatus)) {
    return { ok: false, error: "Invalid status" };
  }

  // approved_at records the latest approval, same as
  // createApprovedVolunteerAction and approveRoleAction's setApproved.
  const now = new Date().toISOString();
  const update: Record<string, string> = { status, updated_at: now };
  if (status === "approved") update.approved_at = now;
  const { error } = await supabase.from("volunteers").update(update).eq("user_id", volunteerId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Admin notes are screening-only (RLS on volunteer_screening_notes enforces
 * this independent of this check — see the 2026-09-22 schema-changes.sql
 * design note), but requireAdmin alone would let a non-screening admin's
 * write silently no-op against RLS with a confusing "success"; checking the
 * flag here first gives them a real error instead.
 */
export async function saveVolunteerAdminNotesAction(
  volunteerId: string,
  notes: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { data: profile } = await supabase
    .from("profiles")
    .select("can_view_volunteer_screening")
    .eq("id", adminCheck.actor.userId)
    .maybeSingle();
  if (!profile?.can_view_volunteer_screening) {
    return { ok: false, error: "You don't have access to volunteer screening notes" };
  }

  const { error } = await supabase.from("volunteer_screening_notes").upsert(
    {
      volunteer_id: volunteerId,
      admin_notes: notes.trim() || null,
      updated_by: adminCheck.actor.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "volunteer_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type ApproveRoleResult =
  | { ok: true; certWarning: boolean }
  | { ok: false; error: string };

/**
 * Approves a role type for a volunteer, recording who and when. Allowed even
 * when the role requires a cert and none is on file — the caller (the admin
 * detail page) is responsible for showing the "cert required, not on file"
 * flag; `certWarning` echoes that back so a fresh approve can surface it
 * immediately without a second round trip.
 *
 * A role approval only makes someone eligible to sign up once
 * volunteers.status is also 'approved' (lib/volunteer-signups.ts). The detail
 * page asks before approving a role for someone who isn't; `setApproved`
 * moves their status to 'approved' in the same action.
 */
export async function approveRoleAction(
  volunteerId: string,
  roleTypeId: number,
  setApproved = false,
): Promise<ApproveRoleResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  if (setApproved) {
    const now = new Date().toISOString();
    const { error: statusError } = await supabase
      .from("volunteers")
      .update({ status: "approved", approved_at: now, updated_at: now })
      .eq("user_id", volunteerId)
      .neq("status", "approved");
    if (statusError) return { ok: false, error: statusError.message };
  }

  const { data: roleType } = await supabase
    .from("volunteer_role_types")
    .select("requires_cert")
    .eq("id", roleTypeId)
    .maybeSingle();
  if (!roleType) return { ok: false, error: "Role type not found" };

  const { error } = await supabase.from("volunteer_role_approvals").insert({
    volunteer_id: volunteerId,
    role_type_id: roleTypeId,
    approved_by: adminCheck.actor.userId,
    approved_at: new Date().toISOString(),
  });
  // 23505 = already has an active approval for this role type — treat as
  // a harmless no-op (e.g. a double click).
  if (error && error.code !== "23505") return { ok: false, error: error.message };

  let certWarning = false;
  if (roleType.requires_cert) {
    const { data: certs } = await supabase
      .from("volunteer_certifications")
      .select("expires_on")
      .eq("volunteer_id", volunteerId)
      .eq("kind", "first_aid_cpr_aed");
    const hasCurrent = (certs ?? []).some(
      (c) => !c.expires_on || new Date(c.expires_on).getTime() >= Date.now(),
    );
    certWarning = !hasCurrent;
  }

  return { ok: true, certWarning };
}

/** Revokes an active approval — sets revoked_by/revoked_at, never deletes
 * the row (see the schema comment on volunteer_role_approvals). */
export async function revokeRoleAction(approvalId: number): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { error } = await supabase
    .from("volunteer_role_approvals")
    .update({ revoked_by: adminCheck.actor.userId, revoked_at: new Date().toISOString() })
    .eq("id", approvalId)
    .is("revoked_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type CreateApprovedVolunteerResult =
  | { ok: true; volunteerId: string }
  | { ok: false; error: string };

/**
 * Backfills someone approved outside the portal: creates the account (if
 * needed) and the volunteers row directly at status 'approved', skipping the
 * invite/registration flow entirely — registered_at stays null (they never
 * went through the form), approved_at is now. Optionally approves a starting
 * set of role types in the same call. No invite email is sent — this is for
 * people already vetted elsewhere, not a new invitation.
 */
export async function createApprovedVolunteerAction(input: {
  email: string;
  firstName: string;
  lastName: string;
  chapter?: string;
  roleTypeIds?: number[];
}): Promise<CreateApprovedVolunteerResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const email = input.email.trim().toLowerCase();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!email) return { ok: false, error: "Email is required" };
  if (!firstName || !lastName) return { ok: false, error: "First and last name are required" };

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  let userId: string;
  let adminClient: ReturnType<typeof createAdminClient> | null = null;
  const getAdminClient = () => {
    if (!adminClient) adminClient = createAdminClient();
    return adminClient;
  };

  if (existingProfile) {
    userId = existingProfile.id as string;
  } else {
    try {
      const { data: created, error: createError } = await getAdminClient().auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { first_name: firstName, last_name: lastName },
      });
      if (createError || !created?.user) {
        return { ok: false, error: createError?.message ?? "Failed to create the volunteer's account" };
      }
      userId = created.user.id;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Admin client unavailable" };
    }

    const { error: profileError } = await getAdminClient()
      .from("profiles")
      .update({ first_name: firstName, last_name: lastName, email, chapter: input.chapter || null })
      .eq("id", userId);
    if (profileError) {
      console.error(`[volunteer-admin] setting profile for backfilled volunteer ${email} failed:`, profileError);
    }
  }

  const { data: existingVolunteer } = await supabase
    .from("volunteers")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existingVolunteer) {
    const { error } = await supabase
      .from("volunteers")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from("volunteers").insert({
      user_id: userId,
      status: "approved",
      approved_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: error.message };
  }

  for (const roleTypeId of input.roleTypeIds ?? []) {
    const { error } = await supabase.from("volunteer_role_approvals").insert({
      volunteer_id: userId,
      role_type_id: roleTypeId,
      approved_by: adminCheck.actor.userId,
      approved_at: new Date().toISOString(),
    });
    if (error && error.code !== "23505") {
      console.error(`[volunteer-admin] approving role ${roleTypeId} for ${email} failed:`, error);
    }
  }

  return { ok: true, volunteerId: userId };
}

/**
 * General operational notes (volunteer_notes) — any admin writes, chapter
 * leads for the volunteer's home chapter read (RLS). Separate from the
 * screening-only notes above. An empty string clears them; there's no
 * delete.
 */
export async function saveVolunteerNotesAction(volunteerId: string, notes: string): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { error } = await supabase.from("volunteer_notes").upsert(
    {
      volunteer_id: volunteerId,
      notes: notes.trim(),
      updated_by: adminCheck.actor.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "volunteer_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
