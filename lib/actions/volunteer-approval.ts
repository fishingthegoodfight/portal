"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { sendVolunteerApprovedEmail } from "@/lib/email/send";

export type ApproveApplicationResult =
  | { ok: true; emailed: boolean; emailError?: string }
  | { ok: false; error: string };

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Approve a volunteer application (phase 4) — admins only, checked again in
 * the database, which also enforces the stage (references in and reviewed)
 * and the first-timer retreat rule. The approval is saved first; the
 * registration email follows. If the email fails the approval stands, and
 * the review screen offers a resend — an approval isn't undone by an email
 * provider's hiccup.
 */
export async function approveApplicationAction(
  applicationId: number,
  roleTypeIds: number[],
): Promise<ApproveApplicationResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: "Only an admin can approve a volunteer application" };

  const { data: roleNames, error } = await supabase.rpc("volunteer_application_approve", {
    p_application_id: applicationId,
    p_role_type_ids: [...new Set(roleTypeIds)],
  });
  if (error) {
    if (error.code === "P0001" || error.code === "42501") return { ok: false, error: error.message };
    console.error(`[volunteer approval] approve ${applicationId}: ${error.code} ${error.message}`);
    return { ok: false, error: "The approval couldn't be saved. Nothing was changed — try again in a moment." };
  }

  const sent = await emailRegistration(supabase, applicationId, (roleNames ?? []) as string[]);
  return sent.ok ? { ok: true, emailed: true } : { ok: true, emailed: false, emailError: sent.error };
}

/** "Resend registration email" on an approved application. Names the roles
 * they're approved for now. */
export async function resendRegistrationEmailAction(
  applicationId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { data: app } = await supabase
    .from("volunteer_applications")
    .select("user_id, status")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app || app.status !== "approved") return { ok: false, error: "This application isn't approved" };

  const { data: approvals } = await supabase
    .from("volunteer_role_approvals")
    .select("role_type:volunteer_role_types(name, sort_order)")
    .eq("volunteer_id", app.user_id as string)
    .is("revoked_at", null);
  const roleNames = ((approvals ?? []) as unknown as { role_type: { name: string; sort_order: number } | null }[])
    .map((a) => a.role_type)
    .filter((r): r is { name: string; sort_order: number } => Boolean(r))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((r) => r.name);

  return emailRegistration(supabase, applicationId, roleNames);
}

async function emailRegistration(
  supabase: ServerClient,
  applicationId: number,
  roleNames: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: app } = await supabase
    .from("volunteer_applications")
    .select("full_name, email")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) return { ok: false, error: "Application not found" };
  const email = app.email as string;

  try {
    await sendVolunteerApprovedEmail({
      toEmail: email,
      recipientName: (app.full_name as string).split(/\s+/)[0] || null,
      roleNames,
    });
  } catch (err) {
    console.error(`[volunteer approval] registration email for ${applicationId} failed:`, err);
    return { ok: false, error: "The registration email didn't send." };
  }

  const { error } = await supabase.rpc("application_record_registration_email", {
    p_application_id: applicationId,
    p_email: email,
  });
  if (error) {
    console.error(`[volunteer approval] recording the registration email for ${applicationId}: ${error.message}`);
    return { ok: false, error: `The email went out, but it wasn't recorded in the history: ${error.message}` };
  }
  return { ok: true };
}
