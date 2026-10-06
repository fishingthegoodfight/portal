import type { createAdminClient } from "@/lib/supabase/admin";
import { profileEmailPattern } from "@/lib/profile-email";

/** The dev endpoints' ?email= or ?user_id= — one person, by profile. */
export async function resolveDevVolunteer(
  admin: ReturnType<typeof createAdminClient>,
  searchParams: URLSearchParams,
): Promise<{ userId: string } | { error: string }> {
  const userId = searchParams.get("user_id")?.trim();
  if (userId) {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return { error: "Invalid ?user_id=<uuid>" };
    return { userId };
  }
  const email = searchParams.get("email")?.trim().toLowerCase();
  if (!email) return { error: "Give ?email=<address> or ?user_id=<uuid>" };
  const { data, error } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", profileEmailPattern(email))
    .limit(2);
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: `No profile with email ${email}` };
  if (data.length > 1) return { error: `More than one profile with email ${email} — use ?user_id=` };
  return { userId: data[0].id as string };
}
