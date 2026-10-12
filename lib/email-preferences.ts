import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The no-sign-in unsubscribe links (table email_preference_tokens — one
 * random token per person, readable by the service role only), for two
 * lists: the volunteer opportunities email (profiles.volunteer_opportunities_email)
 * and chapter emails, the messages leads send from Members and rosters
 * (profiles.chapter_emails). The token is the only key, and all it can do
 * is turn one of those off or back on. Deliberately not a server action
 * module: only server code calls these.
 */

export type EmailList = "opportunities" | "chapter";

const LIST_COLUMN: Record<EmailList, "volunteer_opportunities_email" | "chapter_emails"> = {
  opportunities: "volunteer_opportunities_email",
  chapter: "chapter_emails",
};

/** ?list= on the unsubscribe links; anything else is the opportunities
 * email, which is what the links without one were for. */
export function parseEmailList(value: string | null | undefined): EmailList {
  return value === "chapter" ? "chapter" : "opportunities";
}

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export type UnsubscribeLookup =
  | { found: true; userId: string; maskedEmail: string; subscribed: boolean }
  | { found: false };

/** The person's token, created the first time it's needed. */
export async function ensureUnsubscribeToken(userId: string): Promise<string> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("email_preference_tokens")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) throw new Error(`creating an unsubscribe token: ${error.message}`);
  const { data, error: readError } = await admin
    .from("email_preference_tokens")
    .select("token")
    .eq("user_id", userId)
    .single();
  if (readError || !data) throw new Error(`reading an unsubscribe token: ${readError?.message ?? "none"}`);
  return data.token as string;
}

/** "j••••@example.com" — enough to recognise, no more. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "your address";
  return `${local.slice(0, 1)}${"•".repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

export async function lookupUnsubscribeToken(token: string, list: EmailList = "opportunities"): Promise<UnsubscribeLookup> {
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
    .select("email, volunteer_opportunities_email, chapter_emails")
    .eq("id", row.user_id as string)
    .maybeSingle();
  // A token left behind by a deleted person matches no profile.
  if (!profile) return { found: false };
  return {
    found: true,
    userId: row.user_id as string,
    maskedEmail: maskEmail((profile.email as string | null) ?? ""),
    subscribed: (profile as Record<string, unknown>)[LIST_COLUMN[list]] !== false,
  };
}

/** Turns one list off (or back on) for the token's owner. False when the
 * token matches nobody. */
export async function setEmailListByToken(token: string, list: EmailList, subscribed: boolean): Promise<boolean> {
  const lookup = await lookupUnsubscribeToken(token, list);
  if (!lookup.found) return false;
  const { error } = await createAdminClient()
    .from("profiles")
    .update({ [LIST_COLUMN[list]]: subscribed })
    .eq("id", lookup.userId);
  if (error) {
    console.error("[unsubscribe] update failed:", error.message);
    return false;
  }
  return true;
}
