"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getSiteUrl } from "@/lib/site-url";
import { sendVolunteerInviteEmail } from "@/lib/email/send";

const REGISTER_PATH = "/protected/volunteer/register";
// Where a password-setup link (see buildConfirmUrl) lands once verified —
// set a password, then straight into the registration form. app/auth/error
// also checks for this exact prefix to recognize an expired/used invite.
const SET_PASSWORD_NEXT = `/auth/update-password?next=${encodeURIComponent(REGISTER_PATH)}`;

export type InviteVolunteerResult =
  | { ok: true; wasResend: boolean }
  | { ok: false; error: string };

/**
 * Builds a link through our own /auth/confirm route (token_hash + type,
 * verified server-side with verifyOtp — see app/auth/confirm/route.ts)
 * instead of using Supabase's own action_link. The action_link redirects
 * with the session in a URL *fragment*, which nothing in this app parses
 * (there's no client-side "detect session in URL" step on the registration
 * page), so it silently failed to establish a session; token_hash avoids
 * that entirely by exchanging it for cookies on our own server route.
 */
function buildConfirmUrl(tokenHash: string, type: "invite" | "recovery", next: string): string {
  const url = new URL(`${getSiteUrl()}/auth/confirm`);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  url.searchParams.set("next", next);
  return url.toString();
}

/**
 * Admin "Invite volunteer" action, also used to re-send an invite (called
 * again with the same email — the volunteers row is looked up first, so a
 * resend never duplicates it, per the spec).
 *
 * Three cases, by account state:
 *  - No account at all: creates one via the Supabase Admin API
 *    (generateLink type "invite") and sends a password-setup link.
 *  - An account exists but was never confirmed (an earlier invite that was
 *    never completed — the profiles row exists the instant the auth user is
 *    created, well before they've set a password, so "has a profile" alone
 *    can't tell "done" from "still pending"): generateLink type "invite"
 *    would reject this email as already registered, so this resends via
 *    type "recovery" instead — same password-setup destination.
 *  - A confirmed, working account: no new link is generated; the email just
 *    points at the registration form (they log in as usual).
 * Either way, a `volunteers` row is created at status 'invited' if one
 * doesn't already exist.
 */
export async function inviteVolunteerAction(input: {
  email: string;
  name?: string;
}): Promise<InviteVolunteerResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

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
  let adminClient: ReturnType<typeof createAdminClient> | null = null;
  const getAdminClient = () => {
    if (!adminClient) adminClient = createAdminClient();
    return adminClient;
  };

  if (!existingProfile) {
    let adminClientForCreate: ReturnType<typeof createAdminClient>;
    try {
      adminClientForCreate = getAdminClient();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Admin client unavailable" };
    }
    const { data: link, error: linkError } = await adminClientForCreate.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        redirectTo: `${getSiteUrl()}/auth/confirm`,
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

    let isConfirmed = true;
    try {
      const { data: authUser, error: getUserError } = await getAdminClient().auth.admin.getUserById(userId);
      if (getUserError) throw getUserError;
      isConfirmed = Boolean(authUser.user?.email_confirmed_at);
    } catch (err) {
      // Can't tell — fail safe by assuming they already have a working
      // account rather than risk re-generating a link (which errors on an
      // already-registered email anyway).
      console.error(`[volunteer-invite] checking account state for ${email} failed:`, err);
    }

    if (isConfirmed) {
      needsPasswordSetup = false;
      actionUrl = `${getSiteUrl()}${REGISTER_PATH}`;
    } else {
      // An earlier invite created the account but they never finished
      // setting a password — "invite" type would reject this as an
      // already-registered email, so "recovery" is the resend path that
      // still works, landing on the same set-password step.
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

  if (!existingVolunteer) {
    const { error: insertError } = await supabase
      .from("volunteers")
      .insert({ user_id: userId, status: "invited", invited_at: new Date().toISOString() });
    if (insertError) {
      return { ok: false, error: insertError.message };
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
