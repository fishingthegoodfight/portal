"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findProfileByEmail } from "@/lib/profile-lookup";
import { isEmailAddress, normalizeEmail } from "@/lib/profile-email";
import { sendAccessCodeEmail } from "@/lib/email/send";
import { getSiteUrl } from "@/lib/site-url";
import { safeNext } from "@/lib/safe-next";
import { codePagePath, type CodeMode } from "@/lib/code-page";
import { CODE_MIN_GAP_MINUTES } from "@/lib/one-time-links";

const REGISTER_PATH = "/protected/volunteer/register";
const DEFAULT_PATH = "/protected/events";

export type RequestCodeResult = { ok: true } | { ok: false; error: string };

/**
 * "Send me a code" on the code page. Public, so no sign-in, and the answer
 * is the same whether or not the address has an account (nobody can use it
 * to find out who does). Failures are logged, not shown, for the same
 * reason.
 *
 *  - setup / reset: a "recovery" code from generateLink (email_otp), sent
 *    in our own email (accessCodeEmail) — never Supabase's template. At most
 *    one every CODE_MIN_GAP_MINUTES per address (recovery_sent_at, which
 *    generateLink stamps). Someone whose access was removed gets nothing.
 *  - signup: Supabase re-sends its own Confirm signup email, which carries
 *    the code ({{ .Token }}); Supabase's own rate limit applies.
 */
export async function requestAccessCodeAction(input: {
  email: string;
  mode: CodeMode;
  next?: string | null;
}): Promise<RequestCodeResult> {
  const email = normalizeEmail(input.email);
  if (!isEmailAddress(email)) return { ok: false, error: "Enter a valid email" };

  if (input.mode === "signup") {
    const supabase = await createClient();
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) {
      console.error("[access-code] re-sending the sign-up code failed:", error);
      if (error.status === 429) return { ok: false, error: "Please wait a minute before asking for another code." };
    }
    return { ok: true };
  }

  try {
    const admin = createAdminClient();
    const profile = await findProfileByEmail(admin, email);
    if (!profile || profile.access_removed_at) return { ok: true };
    const userId = profile.id as string;

    const { data: authUser, error: getUserError } = await admin.auth.admin.getUserById(userId);
    if (getUserError || !authUser?.user) return { ok: true };
    const lastSent = authUser.user.recovery_sent_at;
    if (lastSent && Date.now() - new Date(lastSent).getTime() < CODE_MIN_GAP_MINUTES * 60_000) return { ok: true };

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "recovery", email });
    const code = link?.properties?.email_otp;
    if (linkError || !code) throw linkError ?? new Error("no code returned");

    await sendAccessCodeEmail({
      toEmail: email,
      recipientName: (profile.first_name as string | null)?.trim() || null,
      code,
      pageUrl: `${getSiteUrl()}${codePagePath({ mode: input.mode, email, next: safeNext(input.next) })}`,
    });
  } catch (err) {
    console.error("[access-code] sending a code failed:", err);
  }
  return { ok: true };
}

export type VerifyCodeResult = { ok: true; destination: string } | { ok: false; error: string };

/**
 * The code page's submit: checks the code with Supabase (verifyOtp — type
 * "recovery" for setup/reset, "signup" for confirming a new account), which
 * signs them in; then, for setup/reset, saves the new password. Same
 * follow-ups as the old emailed-link route (app/auth/confirm): events that
 * already name their email as lead are assigned to them, and a new sign-up
 * goes back to where it started (user_metadata.return_to).
 *
 * The password is checked before the code is used, so a mismatch doesn't
 * spend it. If saving it fails after the code is accepted, they're signed
 * in and sent to the change-password page instead of being stuck.
 */
export async function verifyAccessCodeAction(input: {
  email: string;
  code: string;
  mode: CodeMode;
  password?: string;
  next?: string | null;
}): Promise<VerifyCodeResult> {
  const email = normalizeEmail(input.email);
  const code = input.code.replace(/\s+/g, "");
  if (!isEmailAddress(email)) return { ok: false, error: "Enter the email the code was sent to." };
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "The code is the six digits in the email." };
  const settingPassword = input.mode !== "signup";
  if (settingPassword && (input.password ?? "").length < 6) {
    return { ok: false, error: "Choose a password of at least 6 characters." };
  }

  const supabase = await createClient();
  const { data: verified, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: input.mode === "signup" ? "signup" : "recovery",
  });
  if (error || !verified?.user) {
    return {
      ok: false,
      error: "That code isn't right, or it has expired or already been used. Check it, or send yourself a new one.",
    };
  }
  const userId = verified.user.id;

  const { error: assignError } = await supabase.rpc("assign_lead_events");
  if (assignError) console.error("[lead-assign] assign_lead_events at sign-in failed:", assignError);

  let destination = safeNext(input.next);
  if (!destination && input.mode === "signup") {
    const saved = verified.user.user_metadata?.return_to;
    if (saved != null) {
      await supabase.auth.updateUser({ data: { return_to: null } }).catch(() => undefined);
      destination = safeNext(saved as string);
    }
  }
  if (!destination && settingPassword) {
    const { data: volunteer } = await supabase
      .from("volunteers")
      .select("registered_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (volunteer && !volunteer.registered_at) destination = REGISTER_PATH;
  }
  destination = destination ?? DEFAULT_PATH;

  if (settingPassword) {
    const { error: passwordError } = await supabase.auth.updateUser({ password: input.password });
    if (passwordError) {
      console.error(`[access-code] saving the new password for ${userId} failed:`, passwordError);
      return {
        ok: true,
        destination: `/auth/update-password?next=${encodeURIComponent(destination)}`,
      };
    }
  }
  return { ok: true, destination };
}
