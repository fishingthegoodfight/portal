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
export const NOT_LOCAL_CHAPTER = "No local chapter";

// Stored in events.chapter for an event with no physical chapter — offered
// alongside CHAPTERS on the event create/edit forms only (never as a
// person's own chapter, so it's kept out of the CHAPTERS list itself).
export const VIRTUAL_CHAPTER = "Virtual";

export function isVirtualChapter(chapter: string | null | undefined): boolean {
  return chapter === VIRTUAL_CHAPTER;
}

/**
 * Distinct timezones any chapter runs events in, as select options for the
 * admin event editor — so an admin picks a zone by name, never a raw UTC
 * offset. Labeled with the chapters that use it, e.g. "Denver (Denver, CO
 * Springs)".
 */
export const TIMEZONE_OPTIONS: { value: string; label: string }[] = Array.from(
  new Set(CHAPTERS.map((c) => c.timezone)),
).map((timezone) => ({
  value: timezone,
  label: `${timezone.replace("America/", "").replace(/_/g, " ")} (${CHAPTERS.filter(
    (c) => c.timezone === timezone,
  )
    .map((c) => c.name)
    .join(", ")})`,
}));

/** The default timezone for a given chapter name — used to seed a new
 * event's timezone field, or as a fallback if an event's own timezone is
 * somehow unset. Virtual events and members with no local chapter fall back
 * to Colorado's zone, same deliberate default as waiverStateForChapter in
 * lib/waivers.ts (keep the two in sync). */
export function timezoneForChapter(chapter: string | null | undefined): string {
  if (chapter === VIRTUAL_CHAPTER || chapter === NOT_LOCAL_CHAPTER) return "America/Denver";
  return CHAPTERS.find((c) => c.name === chapter)?.timezone ?? TIMEZONE_OPTIONS[0]?.value ?? "America/Denver";
}

// =============================================================================
// Chapter filter — the multi-select pills above the events lists
// =============================================================================
// Shared by the participant events list and the admin events index. Carried
// in the URL as `?chapter=` — a comma-separated list of slugs (e.g.
// "denver,virtual"), or "all" — so a selection survives a reload and can be
// shared.

export type ChapterFilterOption = {
  /** Value carried in the `?chapter=` query param. */
  slug: string;
  label: string;
  /** The events.chapter value this pill matches. */
  chapter: string;
};

// Display order after "All". Add new chapters here as they launch; every
// name must match CHAPTERS / events.chapter.
const FILTER_CHAPTER_ORDER = ["Denver", "CO Springs", "Atlanta", "Rome"];

// Where a chapter's pill label differs from its stored name.
const FILTER_LABEL_OVERRIDES: Record<string, string> = {
  "CO Springs": "Colorado Springs",
};

export const CHAPTER_FILTER_OPTIONS: ChapterFilterOption[] = [
  ...FILTER_CHAPTER_ORDER.map((name) => ({
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    label: FILTER_LABEL_OVERRIDES[name] ?? name,
    chapter: name,
  })),
  { slug: "virtual", label: "Virtual", chapter: VIRTUAL_CHAPTER },
];

/** A chapter filter selection: the selected pills' slugs, or null for All. */
export type ChapterSelection = string[] | null;

/**
 * The selection from the `?chapter=` param. With no param (or nothing
 * recognisable in it) it defaults to the person's own chapter plus Virtual —
 * virtual events are open to everyone — or All for anyone with no local
 * chapter.
 */
export function parseChapterSelection(
  param: string | null | undefined,
  profileChapter: string | null | undefined,
): ChapterSelection {
  if (param === "all") return null;
  const slugs = (param ?? "").split(",");
  const selected = CHAPTER_FILTER_OPTIONS.filter((o) => slugs.includes(o.slug)).map((o) => o.slug);
  if (selected.length > 0) return selected;

  const own = CHAPTER_FILTER_OPTIONS.find(
    (o) => o.chapter === profileChapter && !isVirtualChapter(o.chapter),
  );
  return own ? [own.slug, "virtual"] : null;
}

/** The `?chapter=` value for a selection — always explicit, so a chosen
 * selection (All included) isn't replaced by the default on reload. */
export function chapterSelectionParam(selection: ChapterSelection): string {
  return selection && selection.length > 0 ? selection.join(",") : "all";
}

/** The selection after tapping one chapter pill: toggles it; turning off the
 * last one goes back to All. */
export function toggleChapterSelection(selection: ChapterSelection, slug: string): ChapterSelection {
  const current = selection ?? [];
  const next = current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug];
  // Keep display order, so the URL is the same however it was built up.
  const ordered = CHAPTER_FILTER_OPTIONS.map((o) => o.slug).filter((s) => next.includes(s));
  return ordered.length > 0 ? ordered : null;
}

/** Whether an event's chapter passes the selection. */
export function matchesChapterSelection(
  selection: ChapterSelection,
  eventChapter: string | null,
): boolean {
  if (!selection) return true;
  return CHAPTER_FILTER_OPTIONS.some(
    (o) => selection.includes(o.slug) && o.chapter === eventChapter,
  );
}

/** "Denver and Virtual", "Atlanta, Rome and Virtual" — for empty-state copy. */
export function chapterSelectionLabel(selection: ChapterSelection): string {
  if (!selection) return "any chapter";
  const labels = CHAPTER_FILTER_OPTIONS.filter((o) => selection.includes(o.slug)).map(
    (o) => o.label,
  );
  return labels.length > 1
    ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
    : labels[0];
}
