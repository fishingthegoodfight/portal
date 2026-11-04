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

/** Which item a path belongs to: its own path or one of `also`, the
 * longest match winning (so a section's root doesn't claim its sub-pages).
 * The admin root ("Events") matches only exactly, so a page no item claims
 * (someone's person page) highlights nothing. */
function activeHref(pathname: string, items: AdminNavItem[]): string | null {
  let best: { href: string; length: number } | null = null;
  for (const item of items) {
    const prefixes = [...(item.href === "/protected/admin" ? [] : [item.href]), ...(item.also ?? [])];
    const lengths = [
      ...(pathname === item.href ? [item.href.length] : []),
      ...prefixes.filter((prefix) => startsWithPath(pathname, prefix)).map((prefix) => prefix.length),
    ];
    const length = Math.max(-1, ...lengths);
    if (length >= 0 && (!best || length > best.length)) best = { href: item.href, length };
  }
  return best?.href ?? null;
}

/**
 * The bar across the top of every admin page (app/protected/admin/layout),
 * limited to what this person can reach. On a narrow screen it wraps onto a
 * second line rather than scrolling.
 */
export function AdminNav({ items, label = "Admin" }: { items: AdminNavItem[]; label?: string }) {
  const pathname = usePathname();
  const active = activeHref(pathname, items);
  return (
    <nav aria-label={label} className="w-full border-b print:hidden">
      <ul className="flex flex-wrap gap-x-5 text-sm">
        {items.map((item) => {
          const isActive = item.href === active;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-block border-b-2 py-2 transition-colors",
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
