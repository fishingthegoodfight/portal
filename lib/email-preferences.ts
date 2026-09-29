import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The no-sign-in unsubscribe link in the volunteer opportunities email
 * (table email_preference_tokens — one random token per person, readable by
 * the service role only). The token is the only key, and all it can do is
 * turn that one email off or back on. Deliberately not a server action
 * module: only server code calls these.
 */

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export type UnsubscribeLookup =
  | { found: true; userId: string; maskedEmail: string; subscribed: boolean }
  | { found: false };

/** "j••••@example.com" — enough to recognise, no more. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "your address";
  return `${local.slice(0, 1)}${"•".repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

export async function lookupUnsubscribeToken(token: string): Promise<UnsubscribeLookup> {
  if (!TOKEN_PATTERN.test(token)) return { found: false };
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("email_preference_tokens")
    .select("user_id")
    .eq("token", token)
    .maybeSingle();
  if (error) console.error("[unsubscribe] token lookup failed:", error.message);
  if (!row) return { found: false };
  const { data: profile } = await admin
    .from("profiles")
    .select("email, volunteer_opportunities_email")
    .eq("id", row.user_id as string)
    .maybeSingle();
  // A token left behind by a deleted person matches no profile.
  if (!profile) return { found: false };
  return {
    found: true,
    userId: row.user_id as string,
    maskedEmail: maskEmail((profile.email as string | null) ?? ""),
    subscribed: profile.volunteer_opportunities_email !== false,
  };
}

/** Turns the opportunities email off (or back on) for the token's owner.
 * False when the token matches nobody. */
export async function setOpportunitiesEmailByToken(token: string, subscribed: boolean): Promise<boolean> {
  const lookup = await lookupUnsubscribeToken(token);
  if (!lookup.found) return false;
  const { error } = await createAdminClient()
    .from("profiles")
    .update({ volunteer_opportunities_email: subscribed })
    .eq("id", lookup.userId);
  if (error) {
    console.error("[unsubscribe] update failed:", error.message);
    return false;
  }
  return true;
}
