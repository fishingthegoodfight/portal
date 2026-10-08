"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export type CertActionResult = { ok: true } | { ok: false; error: string };

/**
 * Admin: marks a certification as checked (verified_by / verified_at, set
 * only through the admin RLS policy). Shown on the admin screens; it
 * doesn't change whether the cert counts — an upload counts from the start.
 */
export async function verifyCertificationAction(certId: number): Promise<CertActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { data, error } = await supabase
    .from("volunteer_certifications")
    .update({ verified_by: adminCheck.actor.userId, verified_at: new Date().toISOString() })
    .eq("id", certId)
    .is("verified_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Already verified, or no longer on file." };
  return { ok: true };
}

/**
 * A volunteer adds their own First Aid/CPR/AED certification from the
 * Volunteer page. The file is uploaded first, from the browser, into their
 * own folder of the volunteer-certifications bucket (own-folder storage
 * policy); this records it. Expiry date required: it's what the admin
 * Certifications screen tracks.
 */
export async function addOwnCertificationAction(input: {
  filePath: string;
  issuedOn: string;
  expiresOn: string;
}): Promise<CertActionResult> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub as string | undefined;
  if (!userId) return { ok: false, error: "Not signed in" };

  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!input.filePath.startsWith(`${userId}/`)) return { ok: false, error: "Upload the file again." };
  if (!isDate(input.expiresOn)) return { ok: false, error: "Give the expiry date on the certificate." };
  if (input.issuedOn && !isDate(input.issuedOn)) return { ok: false, error: "Check the issue date." };
  if (input.issuedOn && input.issuedOn > input.expiresOn) {
    return { ok: false, error: "The issue date is after the expiry date." };
  }

  const { error } = await supabase.from("volunteer_certifications").insert({
    volunteer_id: userId,
    kind: "first_aid_cpr_aed",
    file_path: input.filePath,
    issued_on: input.issuedOn || null,
    expires_on: input.expiresOn,
  });
  if (error) {
    console.error(`[certifications] recording ${userId}'s upload failed:`, error);
    return { ok: false, error: `The file uploaded but couldn't be recorded: ${error.message}` };
  }
  return { ok: true };
}
