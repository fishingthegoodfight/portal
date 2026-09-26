import Link from "next/link";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";
import { EnvVarWarning } from "@/components/env-var-warning";
import { NavLink } from "@/components/nav-link";
import { hasEnvVars } from "@/lib/utils";

function HeaderWordmark() {
  return (
    <Link href="/" className="font-semibold">
      Fishing the Good Fight
    </Link>
  );
}

/**
 * One auth check backs both halves of the header (nav links on the left,
 * account area on the right) so it only hits Supabase once per render
 * instead of twice.
 */
async function HeaderContent() {
  if (!hasEnvVars) {
    return (
      <>
        <HeaderWordmark />
        <EnvVarWarning />
      </>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims) {
    return (
      <>
        <HeaderWordmark />
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/auth/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/auth/sign-up">Sign up</Link>
          </Button>
        </div>
      </>
    );
  }

  const userId = claims.sub as string;
  const [{ data: profile }, { data: volunteer }, { data: hasEventAdminAccess }] = await Promise.all([
    supabase.from("profiles").select("role, first_name").eq("id", userId).maybeSingle(),
    supabase.from("volunteers").select("user_id").eq("user_id", userId).maybeSingle(),
    supabase.rpc("has_event_admin_access"),
  ]);
  // Admins get the whole admin area; chapter leads and event leads get the
  // same entry point, which shows them only their own events.

  return (
    <>
      <div className="flex gap-5 items-center">
        <Link href="/" className="font-semibold">
          Fishing the Good Fight
        </Link>
        <NavLink href="/protected/events">Events</NavLink>
        <NavLink href="/protected/profile">Profile</NavLink>
        {volunteer && <NavLink href="/protected/volunteer">Volunteer</NavLink>}
        {profile?.role === "admin" ? (
          <NavLink href="/protected/admin">Admin</NavLink>
        ) : (
          hasEventAdminAccess && <NavLink href="/protected/admin">Manage events</NavLink>
        )}
      </div>
      <div className="flex items-center gap-4">
        {/* First name when there is one; the email only if none is on file. */}
        Hey, {(profile?.first_name as string | null)?.trim() || (claims.email as string)}!
        <LogoutButton />
      </div>
    </>
  );
}

export function SiteHeader() {
  return (
    <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16 print:hidden">
      <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
        <Suspense fallback={<HeaderWordmark />}>
          <HeaderContent />
        </Suspense>
      </div>
    </nav>
  );
}
