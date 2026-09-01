export type Chapter = {
  name: string;
  /** USPS 2-letter code — shown alongside the chapter name, e.g. "Atlanta, GA". */
  state: string;
  /** IANA zone the chapter's events run in, e.g. default timezone when creating an event for it. */
  timezone: string;
};

// Keep sorted alphabetically by name — this order is shown as-is in chapter
// dropdowns. Add new chapters here as they launch.
export const CHAPTERS: Chapter[] = [
  { name: "Atlanta", state: "GA", timezone: "America/New_York" },
  { name: "CO Springs", state: "CO", timezone: "America/Denver" },
  { name: "Denver", state: "CO", timezone: "America/Denver" },
  { name: "Rome", state: "GA", timezone: "America/New_York" },
];

// Stored in profiles.chapter for members not local to any chapter above.
export const NOT_LOCAL_CHAPTER = "Not local to a chapter";

// =============================================================================
// Regions — groupings of chapters
// =============================================================================
// Single source of truth for which chapters roll up into which region. The
// events-list filter (and any future region-scoped view) reads it from here;
// `chapters` values must match the `name`s in CHAPTERS / events.chapter.
export const REGIONS: { slug: string; label: string; chapters: string[] }[] = [
  { slug: "colorado", label: "Colorado", chapters: ["Denver", "CO Springs"] },
  { slug: "georgia", label: "Georgia", chapters: ["Atlanta", "Rome"] },
];

// Where a chapter's filter-pill label differs from its stored name.
const FILTER_LABEL_OVERRIDES: Record<string, string> = {
  "CO Springs": "Colorado Springs",
};

export type ChapterFilter = {
  /** Value carried in the `?chapter=` query param. */
  slug: string;
  label: string;
  /** Event chapters this pill matches; null means "no filter" (All). */
  chapters: string[] | null;
};

// The filter pills shown above the events list, in display order: All, each
// region, then each individual chapter.
export const CHAPTER_FILTERS: ChapterFilter[] = [
  { slug: "all", label: "All", chapters: null },
  ...REGIONS.map((region) => ({
    slug: region.slug,
    label: region.label,
    chapters: [...region.chapters],
  })),
  ...REGIONS.flatMap((region) =>
    region.chapters.map((name) => ({
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      label: FILTER_LABEL_OVERRIDES[name] ?? name,
      chapters: [name],
    })),
  ),
];

/** Look up a filter pill by its slug (query-param value); null if unknown. */
export function chapterFilterBySlug(
  slug: string | null | undefined,
): ChapterFilter | null {
  return CHAPTER_FILTERS.find((filter) => filter.slug === slug) ?? null;
}

/**
 * Which pill to select when the URL has no `?chapter=` yet: the one for the
 * member's own chapter (profiles.chapter), or "All" if they have none or
 * aren't local to a chapter.
 */
export function defaultChapterFilterSlug(
  profileChapter: string | null | undefined,
): string {
  const match = CHAPTER_FILTERS.find(
    (filter) =>
      filter.chapters?.length === 1 && filter.chapters[0] === profileChapter,
  );
  return match?.slug ?? "all";
}
