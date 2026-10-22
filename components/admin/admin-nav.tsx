"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export type AdminNavItem = {
  href: string;
  label: string;
  /** Other paths that count as this section (Setup's pages live under
   * several prefixes). */
  also?: string[];
};

const startsWithPath = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Which item a path belongs to: its own path or one of `also`. The admin
 * root ("Events") matches only exactly, so a page no item claims (someone's
 * person page) highlights nothing. */
function activeHref(pathname: string, items: AdminNavItem[]): string | null {
  const match = items.find(
    (item) =>
      pathname === item.href ||
      [...(item.href === "/protected/admin" ? [] : [item.href]), ...(item.also ?? [])].some((prefix) =>
        startsWithPath(pathname, prefix),
      ),
  );
  return match?.href ?? null;
}

/**
 * The bar across the top of every admin page (app/protected/admin/layout),
 * limited to what this person can reach. On a phone it scrolls sideways
 * rather than wrapping.
 */
export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();
  const active = activeHref(pathname, items);
  return (
    <nav aria-label="Admin" className="w-full overflow-x-auto border-b print:hidden">
      <ul className="flex min-w-max gap-5 text-sm">
        {items.map((item) => {
          const isActive = item.href === active;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "-mb-px inline-block border-b-2 py-2 transition-colors",
                  isActive
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
