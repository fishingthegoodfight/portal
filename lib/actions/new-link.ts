"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { buildConfirmUrl } from "@/lib/auth-confirm-link";
import { sendNewLinkEmail } from "@/lib/email/send";

const REGISTER_PATH = "/protected/volunteer/register";
const PROFILE_PATH = "/protected/profile";

/** The shortest gap between two links to the same address — a public form
 * mustn't be a way to fill someone's inbox. */
const MIN_GAP_MS = 2 * 60_000;

export type NewLinkResult = { ok: true } | { ok: false; error: string };

/**
 * "Send me a new link" on the expired-link page (app/auth/error): for
 * someone whose invite link expired or was already used, without having to
 * ask whoever invited them. Emails a fresh set-password link — the same
 * "recovery" link a re-sent invite uses — that lands where their invite
 * would have: the volunteer registration form for an invited volunteer who
 * hasn't registered, otherwise their profile.
 *
 * Public, so no sign-in: it only ever emails the address's own account, and
 * the answer is the same whether or not there is one (nobody can use it to
 * find out who has an account). Someone whose access was removed gets
 * nothing. Failures are logged, not shown, for the same reason.
 */
export async function requestNewLinkAction(emailInput: string): Promise<NewLinkResult> {
  const email = emailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email" };

  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("id, first_name, access_removed_at")
      // Typed by a stranger: % and _ must match themselves.
      .ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`))
      .maybeSingle();
    if (!profile || profile.access_removed_at) return { ok: true };
    const userId = profile.id as string;

    const { data: authUser, error: getUserError } = await admin.auth.admin.getUserById(userId);
    if (getUserError || !authUser?.user) return { ok: true };
    // generateLink stamps recovery_sent_at, so this also covers a re-sent
    // invite a moment ago.
    const lastSent = authUser.user.recovery_sent_at;
    if (lastSent && Date.now() - new Date(lastSent).getTime() < MIN_GAP_MS) return { ok: true };

    const { data: volunteer } = await admin
      .from("volunteers")
      .select("registered_at")
      .eq("user_id", userId)
      .maybeSingle();
    const destination = volunteer && !volunteer.registered_at ? REGISTER_PATH : PROFILE_PATH;

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "recovery", email });
    if (linkError || !link?.properties) throw linkError ?? new Error("no link returned");

    await sendNewLinkEmail({
      toEmail: email,
      recipientName: (profile.first_name as string | null)?.trim() || null,
      actionUrl: buildConfirmUrl(
        link.properties.hashed_token,
        "recovery",
        `/auth/update-password?next=${encodeURIComponent(destination)}`,
      ),
    });
  } catch (err) {
    console.error("[new-link] sending a new link failed:", err);
  }
  return { ok: true };
}
