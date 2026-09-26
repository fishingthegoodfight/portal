"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getSiteUrl } from "@/lib/site-url";
import { authConfirmUrl, buildConfirmUrl } from "@/lib/auth-confirm-link";
import { sendVolunteerInviteEmail } from "@/lib/email/send";
import { PORTAL_INVITE_BATCH_LIMIT } from "@/lib/volunteers";

const REGISTER_PATH = "/protected/volunteer/register";
// Where a password-setup link (see buildConfirmUrl) lands once verified —
// set a password, then straight into the registration form. app/auth/error
// also checks for this exact prefix to recognize an expired/used invite.
const SET_PASSWORD_NEXT = `/auth/update-password?next=${encodeURIComponent(REGISTER_PATH)}`;

export type InviteVolunteerResult =
  | { ok: true; wasResend: boolean }
  | { ok: false; error: string };

/**
 * Admin "Invite volunteer" action, also used to re-send an invite (called
 * again with the same email — the volunteers row is looked up first, so a
 * resend never duplicates it, per the spec) and by "Send portal invite" on
 * the Volunteers list (sendPortalInvitesAction, below).
 *
 * Three cases, by account state:
 *  - No account at all: creates one via the Supabase Admin API
 *    (generateLink type "invite") and sends a password-setup link.
 *  - An account that has never signed in — an earlier invite never
 *    completed, a backfilled volunteer, or an imported one (the profiles row
 *    exists the instant the auth user is created, and backfill/import create
 *    accounts with no password, so "has a profile" or even "is confirmed"
 *    can't tell "done" from "still pending"; last_sign_in_at can):
 *    generateLink type "invite" would reject this email as already
 *    registered, so this sends a fresh "recovery" link instead — same
 *    password-setup destination. Every re-send is a new link.
 *  - An account that has signed in: no new link is generated; the email
 *    just points at the registration form (they log in as usual).
 * Either way, a `volunteers` row is created at status 'invited' if one
 * doesn't already exist (an existing one keeps its status — an approved
 * volunteer stays approved), and invited_at is stamped with this send.
 */
export async function inviteVolunteerAction(input: {
  email: string;
  name?: string;
}): Promise<InviteVolunteerResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  return inviteOne(supabase, lazyAdminClient(), input);
}

export type PortalInviteOutcome = {
  volunteerId: string;
  name: string;
  email: string;
  ok: boolean;
  error?: string;
};

export type SendPortalInvitesResult =
  | { ok: true; outcomes: PortalInviteOutcome[] }
  | { ok: false; error: string };

/**
 * "Send portal invite" on the Volunteers list, for one volunteer or a
 * selection — the same invite as above, one person at a time. Refuses more
 * than PORTAL_INVITE_BATCH_LIMIT at once, so a mis-click can't email the
 * roster. Each person's outcome is reported separately: one failure doesn't
 * stop the rest.
 */
export async function sendPortalInvitesAction(volunteerIds: string[]): Promise<SendPortalInvitesResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const ids = [...new Set(volunteerIds)];
  if (ids.length === 0) return { ok: false, error: "Choose at least one volunteer" };
  if (ids.length > PORTAL_INVITE_BATCH_LIMIT) {
    return { ok: false, error: `At most ${PORTAL_INVITE_BATCH_LIMIT} invites at a time` };
  }

  const [{ data: volunteers }, { data: profiles }] = await Promise.all([
    supabase.from("volunteers").select("user_id").in("user_id", ids),
    supabase.from("profiles").select("id, first_name, last_name, email").in("id", ids),
  ]);
  const isVolunteer = new Set((volunteers ?? []).map((v) => v.user_id as string));
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  const getAdminClient = lazyAdminClient();
  const outcomes: PortalInviteOutcome[] = [];
  for (const [index, id] of ids.entries()) {
    // Spaced out to stay under the email provider's per-second rate limit.
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 600));
    const profile = profileById.get(id);
    const email = ((profile?.email as string | null) ?? "").trim();
    const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
    if (!isVolunteer.has(id) || !email) {
      outcomes.push({ volunteerId: id, name, email, ok: false, error: "No volunteer record with an email" });
      continue;
    }
    const result = await inviteOne(supabase, getAdminClient, { email });
    outcomes.push({ volunteerId: id, name, email, ok: result.ok, error: result.ok ? undefined : result.error });
  }
  return { ok: true, outcomes };
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;
type AdminClient = ReturnType<typeof createAdminClient>;

function lazyAdminClient(): () => AdminClient {
  let adminClient: AdminClient | null = null;
  return () => {
    if (!adminClient) adminClient = createAdminClient();
    return adminClient;
  };
}

/** One invite, for a caller that has already checked requireAdmin. */
async function inviteOne(
  supabase: ServerClient,
  getAdminClient: () => AdminClient,
  input: { email: string; name?: string },
): Promise<InviteVolunteerResult> {
  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, error: "Email is required" };
  const name = (input.name ?? "").trim();
  const [firstName, ...rest] = name.split(/\s+/).filter(Boolean);
  const lastName = rest.join(" ");

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .ilike("email", email)
    .maybeSingle();

  let userId: string;
  let needsPasswordSetup: boolean;
  let actionUrl: string;

  if (!existingProfile) {
    let adminClientForCreate: AdminClient;
    try {
      adminClientForCreate = getAdminClient();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Admin client unavailable" };
    }
    const { data: link, error: linkError } = await adminClientForCreate.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        redirectTo: authConfirmUrl(),
        data: firstName ? { first_name: firstName, last_name: lastName } : undefined,
      },
    });
    if (linkError || !link?.user) {
      return { ok: false, error: linkError?.message ?? "Failed to create the volunteer's account" };
    }
    userId = link.user.id;
    needsPasswordSetup = true;
    actionUrl = buildConfirmUrl(link.properties.hashed_token, "invite", SET_PASSWORD_NEXT);

    // handle_new_user() (the signup trigger) only copies id/email/
    // directory_opt_in from auth metadata — fill in the name here, same as
    // the walk-up flow does after creating an auth user.
    if (firstName) {
      const { error: profileError } = await getAdminClient()
        .from("profiles")
        .update({ first_name: firstName, last_name: lastName })
        .eq("id", userId);
      if (profileError) {
        console.error(`[volunteer-invite] setting name for ${email} failed:`, profileError);
      }
    }
  } else {
    userId = existingProfile.id as string;

    // Signed in at least once = a working account. Not email_confirmed_at:
    // backfilled volunteers are created confirmed but with no password.
    let hasSignedIn = true;
    try {
      const { data: authUser, error: getUserError } = await getAdminClient().auth.admin.getUserById(userId);
      if (getUserError) throw getUserError;
      hasSignedIn = Boolean(authUser.user?.last_sign_in_at);
    } catch (err) {
      // Can't tell — fail safe by assuming they already have a working
      // account rather than risk re-generating a link.
      console.error(`[volunteer-invite] checking account state for ${email} failed:`, err);
    }

    if (hasSignedIn) {
      needsPasswordSetup = false;
      actionUrl = `${getSiteUrl()}${REGISTER_PATH}`;
    } else {
      // The account exists but has never been used (an unfinished invite,
      // a backfill or an import) — "invite" type would reject this as an
      // already-registered email, so "recovery" is the path that works,
      // landing on the same set-password step.
      try {
        const { data: link, error: linkError } = await getAdminClient().auth.admin.generateLink({
          type: "recovery",
          email,
        });
        if (linkError || !link?.properties) {
          return { ok: false, error: linkError?.message ?? "Failed to generate a new invite link" };
        }
        needsPasswordSetup = true;
        actionUrl = buildConfirmUrl(link.properties.hashed_token, "recovery", SET_PASSWORD_NEXT);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Admin client unavailable" };
      }
    }
  }

  const { data: existingVolunteer } = await supabase
    .from("volunteers")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  const wasResend = Boolean(existingVolunteer);
  const now = new Date().toISOString();

  if (!existingVolunteer) {
    const { error: insertError } = await supabase
      .from("volunteers")
      .insert({ user_id: userId, status: "invited", invited_at: now });
    if (insertError) {
      return { ok: false, error: insertError.message };
    }
  } else {
    // The latest send — the Volunteers list shows "Invited <date>" from this.
    const { error: stampError } = await supabase
      .from("volunteers")
      .update({ invited_at: now, updated_at: now })
      .eq("user_id", userId);
    if (stampError) {
      console.error(`[volunteer-invite] stamping invited_at for ${email} failed:`, stampError);
    }
  }

  try {
    await sendVolunteerInviteEmail({
      toEmail: email,
      recipientName: firstName || existingProfile?.first_name || null,
      actionUrl,
      needsPasswordSetup,
    });
  } catch (err) {
    console.error(`[volunteer-invite] sending invite email to ${email} failed:`, err);
    return {
      ok: false,
      error: `The volunteer record was saved, but the invite email failed to send: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  return { ok: true, wasResend };
}
