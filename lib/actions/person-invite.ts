"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { authConfirmUrl, buildConfirmUrl } from "@/lib/auth-confirm-link";
import { sendPersonInviteEmail } from "@/lib/email/send";
import { setDataAccessAction, setUserRoleAction } from "@/lib/actions/roles";
import type { Role } from "@/lib/roles";
import { CHAPTERS, VIRTUAL_CHAPTER } from "@/lib/chapters";

// Set a password, then their profile — the volunteer invite's account setup
// without the registration form. The /auth/update-password prefix is also
// what app/auth/error recognizes as an expired/used invite.
const PROFILE_PATH = "/protected/profile";
const SET_PASSWORD_NEXT = `/auth/update-password?next=${encodeURIComponent(PROFILE_PATH)}`;

const ROLES: Role[] = ["participant", "chapter_lead", "admin"];
const CHAPTER_NAMES = new Set([...CHAPTERS.map((c) => c.name), VIRTUAL_CHAPTER]);

export type InvitePersonInput = {
  email: string;
  name: string;
  role: Role;
  /** Only for a chapter lead. */
  ledChapters: string[];
  canViewScreening: boolean;
  canViewHealthHistory: boolean;
};

export type InvitePersonResult =
  | { ok: true; wasResend: boolean }
  | { ok: false; error: string };


/**
 * Admin "Invite a person": an account and a profile, nothing
 * volunteer-specific — no volunteers row, so no registration form, volunteer
 * waiver, health-history placeholder or approval status. For staff, board
 * members, anyone who needs to sign in without joining the volunteer team.
 * The volunteer invite (inviteVolunteerAction) is separate and unchanged; if
 * this person is later invited as a volunteer, it finds their profile by
 * email and adds the volunteers row to it.
 *
 * By account state:
 *  - No account: creates one (generateLink "invite") and emails a
 *    set-password link that lands on their profile.
 *  - An account that was never confirmed (an earlier invite, of either kind,
 *    they didn't finish): re-sends via "recovery" — same destination.
 *  - A confirmed account: refused, with a pointer to changing their role
 *    below. Nothing is sent and nothing changes.
 * Role and flags are applied through the same admin-only functions as the
 * People & roles rows (admin_set_user_role, admin_set_data_access), before
 * the email goes out.
 */
export async function invitePersonAction(input: InvitePersonInput): Promise<InvitePersonResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email" };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required" };
  const [firstName, ...rest] = name.split(/\s+/).filter(Boolean);
  const lastName = rest.join(" ");

  // Checked before any account exists, so a bad choice never leaves a
  // half-set-up invite behind.
  if (!ROLES.includes(input.role)) return { ok: false, error: "Choose a role" };
  const ledChapters = input.role === "chapter_lead" ? [...new Set(input.ledChapters)] : [];
  if (ledChapters.some((c) => !CHAPTER_NAMES.has(c))) return { ok: false, error: "Unknown chapter" };
  if (input.role === "chapter_lead" && ledChapters.length === 0) {
    return { ok: false, error: "Pick at least one chapter for a chapter lead" };
  }

  let adminClient: ReturnType<typeof createAdminClient>;
  try {
    adminClient = createAdminClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Admin client unavailable" };
  }

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id, first_name, role, led_chapters, can_view_volunteer_screening, can_view_health_history")
    .ilike("email", email)
    .maybeSingle();

  let userId: string;
  let actionUrl: string;

  if (!existingProfile) {
    const { data: link, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        redirectTo: authConfirmUrl(),
        data: { first_name: firstName, last_name: lastName },
      },
    });
    if (linkError || !link?.user) {
      return { ok: false, error: linkError?.message ?? "Failed to create the account" };
    }
    userId = link.user.id;
    actionUrl = buildConfirmUrl(link.properties.hashed_token, "invite", SET_PASSWORD_NEXT);

    // handle_new_user() only copies id/email/directory_opt_in — the name is
    // filled in here, as the volunteer invite does.
    const { error: profileError } = await adminClient
      .from("profiles")
      .update({ first_name: firstName, last_name: lastName })
      .eq("id", userId);
    if (profileError) {
      console.error(`[person-invite] setting name for ${email} failed:`, profileError);
    }
  } else {
    userId = existingProfile.id as string;
    const { data: authUser, error: getUserError } = await adminClient.auth.admin.getUserById(userId);
    if (getUserError) return { ok: false, error: getUserError.message };
    if (authUser.user?.email_confirmed_at) {
      return {
        ok: false,
        error: `${email} already has an account. Search for them under "Find someone" to change their role or access.`,
      };
    }
    const { data: link, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email,
    });
    if (linkError || !link?.properties) {
      return { ok: false, error: linkError?.message ?? "Failed to generate a new invite link" };
    }
    actionUrl = buildConfirmUrl(link.properties.hashed_token, "recovery", SET_PASSWORD_NEXT);
  }

  // Only what differs from what's on file — a resend never re-saves a role
  // it doesn't change.
  const current = {
    role: ((existingProfile?.role as Role | undefined) ?? "participant") as Role,
    ledChapters: (existingProfile?.led_chapters as string[] | undefined) ?? [],
    screening: Boolean(existingProfile?.can_view_volunteer_screening),
    healthHistory: Boolean(existingProfile?.can_view_health_history),
  };
  const sameChapters =
    current.ledChapters.length === ledChapters.length &&
    ledChapters.every((c) => current.ledChapters.includes(c));
  if (input.role !== current.role || !sameChapters) {
    const roleResult = await setUserRoleAction(userId, input.role, ledChapters);
    if (!roleResult.ok) {
      return {
        ok: false,
        error: `The account is set up, but the role wasn't set (${roleResult.error}). No email was sent — fix it and invite again to re-send.`,
      };
    }
  }
  if (input.canViewScreening !== current.screening || input.canViewHealthHistory !== current.healthHistory) {
    const flagsResult = await setDataAccessAction(userId, {
      screening: input.canViewScreening,
      healthHistory: input.canViewHealthHistory,
    });
    if (!flagsResult.ok) {
      return {
        ok: false,
        error: `The account is set up, but sensitive-data access wasn't set (${flagsResult.error}). No email was sent — fix it and invite again to re-send.`,
      };
    }
  }

  try {
    await sendPersonInviteEmail({
      toEmail: email,
      recipientName: firstName || (existingProfile?.first_name as string | null) || null,
      actionUrl,
    });
  } catch (err) {
    console.error(`[person-invite] sending invite email to ${email} failed:`, err);
    return {
      ok: false,
      error: `The account was set up, but the invite email failed to send: ${
        err instanceof Error ? err.message : String(err)
      }. Invite them again to re-send.`,
    };
  }

  return { ok: true, wasResend: Boolean(existingProfile) };
}
