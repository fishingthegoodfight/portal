"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * A header nav link that highlights itself for its whole section, not just
 * an exact match — /protected/events/5/rsvp still highlights "Events",
 * /protected/admin/events/5 still highlights "Admin". Both link states
 * always carry a border (transparent when inactive) so switching between
 * them never shifts layout.
 */
export function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "border-b-2 pb-0.5 transition-colors",
        active
          ? "text-foreground font-medium border-foreground"
          : "text-muted-foreground border-transparent hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
