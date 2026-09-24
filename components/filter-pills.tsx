import Link from "next/link";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

import {
  CHAPTER_FILTER_OPTIONS,
  chapterSelectionParam,
  toggleChapterSelection,
  type ChapterSelection,
} from "@/lib/chapters";
import { cn } from "@/lib/utils";

/**
 * Link-based filter pills — each pill is a plain link to the filtered URL, so
 * the selection lives in the query string (survives a reload, can be shared)
 * and needs no client JavaScript.
 */

/** One pill. Active pills are filled with a check mark, so it's obvious
 * which are on when several can be at once. */
export function FilterPill({
  href,
  active,
  children,
  className,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors",
        active
          ? "border-foreground bg-foreground font-medium text-background"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {active && <Check className="size-3.5" strokeWidth={2.5} aria-hidden />}
      {children}
    </Link>
  );
}

/** Builds a URL from a base path and query params, leaving out empty ones. */
export function filterHref(basePath: string, params: Record<string, string | undefined>): string {
  const query = Object.entries(params)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${encodeURIComponent(value).replace(/%2C/g, ",")}`)
    .join("&");
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * All · Denver · Colorado Springs · Atlanta · Rome · Virtual — multi-select.
 * Tapping a chapter toggles it (and clears All); tapping All clears the
 * rest. The same control on the participant events list and the admin
 * events index.
 */
export function ChapterFilterPills({
  selection,
  basePath,
  otherParams = {},
}: {
  selection: ChapterSelection;
  basePath: string;
  /** The page's other filter params, kept as they are when a pill is tapped. */
  otherParams?: Record<string, string | undefined>;
}) {
  const href = (next: ChapterSelection) =>
    filterHref(basePath, { chapter: chapterSelectionParam(next), ...otherParams });

  return (
    <div role="group" aria-label="Filter by chapter" className="flex flex-wrap gap-2">
      <FilterPill href={href(null)} active={selection === null}>
        All
      </FilterPill>
      {CHAPTER_FILTER_OPTIONS.map((option) => (
        <FilterPill
          key={option.slug}
          href={href(toggleChapterSelection(selection, option.slug))}
          active={selection?.includes(option.slug) ?? false}
        >
          {option.label}
        </FilterPill>
      ))}
    </div>
  );
}
