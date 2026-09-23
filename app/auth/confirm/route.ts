import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";
import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Where a just-confirmed NEW account goes: the destination saved on the
 * account at sign-up (user_metadata.return_to — e.g. the RSVP page of the
 * public event they signed up from; see sign-up-form.tsx), which doesn't
 * depend on the confirmation email's link carrying it and survives opening
 * that email on another device. Cleared once used. Other link types
 * (invite, recovery, …) keep their own `next`.
 */
async function signupDestination(
  supabase: ServerClient,
  type: EmailOtpType,
  next: string,
): Promise<string> {
  if (type !== "signup" && type !== "email") return next;
  const { data } = await supabase.auth.getUser();
  const saved = data.user?.user_metadata?.return_to;
  if (saved == null) return next;
  await supabase.auth.updateUser({ data: { return_to: null } }).catch(() => undefined);
  return safeNext(saved) ?? next;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  if (token_hash && type) {
    const supabase = await createClient();

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });
    if (!error) {
      // redirect user to specified redirect URL or root of app
      redirect(await signupDestination(supabase, type, next));
    }

    // Invite/recovery tokens are single-use, so a click that fails here
    // often just means "already redeemed" rather than "never valid" — e.g.
    // the invited user already opened this same link once (establishing a
    // session) and is now clicking it again from the same email. If the
    // browser already carries a usable session, don't show the expired-link
    // error: just continue on to wherever the link was headed, same as a
    // successful verify would have.
    const { data: existingSession } = await supabase.auth.getClaims();
    if (existingSession?.claims) {
      redirect(await signupDestination(supabase, type, next));
    }

    // redirect the user to an error page with some instructions — `type`
    // and `next` (where this link was headed) let that page recognize
    // e.g. an expired/used volunteer invite and give a specific message
    // instead of a generic one.
    redirect(
      `/auth/error?error=${encodeURIComponent(error.message)}&type=${encodeURIComponent(type)}&next=${encodeURIComponent(next)}`,
    );
  }

  // redirect the user to an error page with some instructions
  redirect(`/auth/error?error=${encodeURIComponent("No token hash or type")}`);
}
