import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An account as the lead block names it. */
export type LeadAccount = { id: string; name: string; email: string };

type ProfileRow = { id: string; first_name: string | null; last_name: string | null; email: string | null };

function toAccount(row: ProfileRow): LeadAccount {
  const email = (row.email ?? "").trim();
  return { id: row.id, name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || email, email };
}

/**
 * The account an event's lead_user_id points at — for saying who actually
 * has access, whatever the free-text lead name says. Read with the service
 * role: a chapter lead or event lead can't otherwise read the profile of
 * someone who isn't on one of their events. Callers gate first.
 */
export async function loadLeadAccount(leadUserId: string | null | undefined): Promise<LeadAccount | null> {
  if (!leadUserId || !UUID_PATTERN.test(leadUserId)) return null;
  const { data } = await createAdminClient()
    .from("profiles")
    .select("id, first_name, last_name, email")
    .eq("id", leadUserId)
    .maybeSingle();
  return data ? toAccount(data as ProfileRow) : null;
}

/**
 * "Named as one person, assigned to another": the event is assigned to one
 * account while the lead email typed beside it belongs to a different one.
 * Returns the message to refuse the save with, or null when there's no
 * clash — no assignment, no email, an email with no account, or the
 * assigned account's own. (A different contact email that isn't anyone's
 * account is fine: the contact details are what attendees see.)
 */
export async function leadAssignmentProblem(
  leadUserId: string | null | undefined,
  leadEmail: string | null | undefined,
): Promise<string | null> {
  const email = (leadEmail ?? "").trim();
  if (!leadUserId || !email) return null;
  const admin = createAdminClient();
  const { data: owner } = await admin
    .from("profiles")
    .select("id, first_name, last_name, email")
    .ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`))
    .limit(1)
    .maybeSingle();
  if (!owner || owner.id === leadUserId) return null;
  const assigned = await loadLeadAccount(leadUserId);
  return `The lead email belongs to ${toAccount(owner as ProfileRow).name}, but the event is assigned to ${
    assigned?.name ?? "someone else"
  }. Assign the person named, or remove the assignment.`;
}

/**
 * For an account an admin-side action has just created (an invite, a
 * walk-up, the volunteer import): assigns it to every upcoming event that
 * already names its email as the lead and has nobody assigned —
 * assign_lead_events, which holds the rules (exact email, never overwrite,
 * upcoming and not cancelled) and records each one. `admin` is the
 * service-role client that created the account. Never throws and never
 * blocks the action it's part of: a failure is logged, and the person's
 * first sign-in (app/auth/confirm) tries again.
 */
export async function assignLeadEventsToNewAccount(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<void> {
  try {
    const { data, error } = await admin.rpc("assign_lead_events", { p_user_id: userId });
    if (error) throw error;
    if (data) console.log(`[lead-assign] new account ${userId}: assigned as lead of ${data} event(s)`);
  } catch (err) {
    console.error(`[lead-assign] new account ${userId}: assign_lead_events failed:`, err);
  }
}
