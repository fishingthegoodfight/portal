import type { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail, profileEmailPattern } from "@/lib/profile-email";

/**
 * The whole profile of whoever owns this email, or null. Matched on
 * profiles.email first; failing that, on the email they log in with
 * (auth_user_id_by_email), so a profile whose email has drifted from the
 * login email is still found rather than treated as a new person. Service
 * role only: callers gate first.
 */
export async function findProfileByEmail(
  admin: ReturnType<typeof createAdminClient>,
  emailInput: string,
): Promise<Record<string, unknown> | null> {
  const email = normalizeEmail(emailInput);
  if (!email) return null;
  const { data: byProfile } = await admin
    .from("profiles")
    .select("*")
    .ilike("email", profileEmailPattern(email))
    .maybeSingle();
  if (byProfile) return byProfile as Record<string, unknown>;

  const { data: authUserId } = await admin.rpc("auth_user_id_by_email", { p_email: email });
  if (!authUserId) return null;
  const { data: byLogin } = await admin.from("profiles").select("*").eq("id", authUserId as string).maybeSingle();
  return (byLogin as Record<string, unknown> | null) ?? null;
}
