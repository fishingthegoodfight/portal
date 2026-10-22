import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";
import { MobileNav, type NavItem } from "@/components/mobile-nav";
import { NavLink } from "@/components/nav-link";

/** The two-line logo; the reversed (white-lettered) one in dark mode. */
function HeaderWordmark() {
  return (
    <Link href="/" className="shrink-0" aria-label="Fishing the Good Fight home">
      <Image
        src="/brand/header-logo.png"
        alt="Fishing the Good Fight"
        width={490}
        height={96}
        priority
        className="h-8 w-auto sm:h-10 dark:hidden"
      />
      <Image
        src="/brand/header-logo-reversed.png"
        alt="Fishing the Good Fight"
        width={490}
        height={96}
        priority
        className="hidden h-8 w-auto sm:h-10 dark:block"
      />
    </Link>
  );
}

/**
 * One auth check backs both halves of the header (nav links on the left,
 * account area on the right) so it only hits Supabase once per render
 * instead of twice.
 */
async function HeaderContent() {
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
  const [{ data: profile }, { data: volunteer }, { data: hasEventAdminAccess }, { data: memberChapters }] = await Promise.all([
    supabase.from("profiles").select("role, first_name").eq("id", userId).maybeSingle(),
    supabase.from("volunteers").select("user_id").eq("user_id", userId).maybeSingle(),
    supabase.rpc("has_event_admin_access"),
    // Members: admins, chapter leads, and the chapter leadership team.
    supabase.rpc("my_member_chapters"),
  ]);
  const items: NavItem[] = [
    { href: "/protected/events", label: "Events" },
    { href: "/protected/profile", label: "Profile" },
    ...(volunteer ? [{ href: "/protected/volunteer", label: "Volunteer" }] : []),
    ...(profile?.role === "admin" || ((memberChapters as string[] | null) ?? []).length > 0
      ? [{ href: "/protected/members", label: "Members" }]
      : []),
    // Admins get the whole admin area; chapter leads and event leads get the
    // same entry point, which shows them only their own events.
    ...(profile?.role === "admin"
      ? [{ href: "/protected/admin", label: "Admin" }]
      : hasEventAdminAccess
        ? [{ href: "/protected/admin", label: "Manage events" }]
        : []),
  ];
  // First name when there is one; the email only if none is on file.
  const greeting = `Hey, ${(profile?.first_name as string | null)?.trim() || (claims.email as string)}!`;

  // Phones get the Menu button instead of the link row and greeting, which
  // don't fit beside the wordmark.
  return (
    <>
      <div className="flex gap-5 items-center">
        <HeaderWordmark />
        {items.map((item) => (
          <span key={item.href} className="hidden md:inline">
            <NavLink href={item.href}>{item.label}</NavLink>
          </span>
        ))}
      </div>
      <div className="hidden md:flex items-center gap-4">
        <span className="hidden lg:inline">{greeting}</span>
        <LogoutButton />
      </div>
      <MobileNav items={items} greeting={greeting} />
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
