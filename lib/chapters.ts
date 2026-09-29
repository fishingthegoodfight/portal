import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Chapters and the regions above them (tables `chapters` and `regions`, see
 * the 2026-09-29 "Regions and chapters as data" schema-changes.sql entry),
 * managed in Setup. events.chapter, profiles.chapter, led_chapters etc.
 * store a chapter's NAME as plain text, so renaming one goes through
 * admin_rename_chapter, which rewrites every stored copy.
 *
 * Load the list once per request (loadChapters) and pass it to the helpers
 * below; client components get it as a prop from their page.
 */

export type Region = {
  id: number;
  name: string;
  sort_order: number;
  active: boolean;
};

export type Chapter = {
  id: number;
  name: string;
  /** A longer label where the name is abbreviated ("Colorado Springs" for
   * "CO Springs") — filter pills and the application form. Null = name. */
  display_name: string | null;
  region_id: number;
  /** USPS 2-letter code — shown alongside the name, e.g. "Atlanta, GA", and
   * the chapter's waiver state. */
  state: string;
  /** IANA zone the chapter's events run in, e.g. the default timezone when
   * creating an event for it. */
  timezone: string;
  sort_order: number;
  active: boolean;
};

export const REGION_COLUMNS = "id, name, sort_order, active";
export const CHAPTER_COLUMNS = "id, name, display_name, region_id, state, timezone, sort_order, active";

/** Chapters in display order: by region's order, then the chapter's own. */
export function sortChapters(chapters: Chapter[], regions: Region[]): Chapter[] {
  const regionOrder = new Map(regions.map((r) => [r.id, r.sort_order]));
  return [...chapters].sort(
    (a, b) =>
      (regionOrder.get(a.region_id) ?? 0) - (regionOrder.get(b.region_id) ?? 0) ||
      a.region_id - b.region_id ||
      a.sort_order - b.sort_order ||
      a.name.localeCompare(b.name),
  );
}

/** Every region and chapter (inactive included), chapters in display order.
 * Throws if either can't be read — nothing chapter-dependent works without
 * them. */
export async function loadRegionsAndChapters(
  supabase: SupabaseClient,
): Promise<{ regions: Region[]; chapters: Chapter[] }> {
  const [regionsResult, chaptersResult] = await Promise.all([
    supabase.from("regions").select(REGION_COLUMNS).order("sort_order", { ascending: true }),
    supabase.from("chapters").select(CHAPTER_COLUMNS),
  ]);
  if (regionsResult.error) throw new Error(`loading regions: ${regionsResult.error.message}`);
  if (chaptersResult.error) throw new Error(`loading chapters: ${chaptersResult.error.message}`);
  const regions = (regionsResult.data ?? []) as Region[];
  return { regions, chapters: sortChapters((chaptersResult.data ?? []) as Chapter[], regions) };
}

/** Every chapter (inactive included), in display order. */
export async function loadChapters(supabase: SupabaseClient): Promise<Chapter[]> {
  return (await loadRegionsAndChapters(supabase)).chapters;
}

/** The chapters offered for new choices. */
export function activeChapters(chapters: Chapter[]): Chapter[] {
  return chapters.filter((c) => c.active);
}

/** Whether `name` is a chapter (active or not). */
export function isChapterName(chapters: Chapter[], name: string | null | undefined): boolean {
  return !!name && chapters.some((c) => c.name === name);
}

export function chapterByName(chapters: Chapter[], name: string | null | undefined): Chapter | undefined {
  return name ? chapters.find((c) => c.name === name) : undefined;
}

/** The chapter's longer label if it has one, else its name. */
export function chapterDisplayName(chapters: Chapter[], name: string): string {
  return chapterByName(chapters, name)?.display_name ?? name;
}

// Stored in profiles.chapter for members not local to any chapter above.
export const NOT_LOCAL_CHAPTER = "No local chapter";

// Earlier spellings still found on older profiles, and what each is now.
const LEGACY_HOME_CHAPTERS: Record<string, string> = {
  "Colorado Springs": "CO Springs",
  "Not local to a chapter": NOT_LOCAL_CHAPTER,
};

/** A stored home chapter's current name — maps the earlier spellings. */
export function currentHomeChapterName(stored: string | null | undefined): string {
  const value = (stored ?? "").trim();
  return LEGACY_HOME_CHAPTERS[value] ?? value;
}

/** A stored home chapter as one of the dropdown's values (HomeChapterField),
 * or "" when it isn't one. Maps the earlier spellings, so a profile that has
 * a chapter never shows the dropdown blank. */
export function homeChapterOption(stored: string | null | undefined, chapters: Chapter[]): string {
  const current = currentHomeChapterName(stored);
  return current === NOT_LOCAL_CHAPTER || isChapterName(chapters, current) ? current : "";
}

// Stored in events.chapter for an event with no physical chapter — offered
// alongside the chapters on the event create/edit forms only (never as a
// person's own chapter).
export const VIRTUAL_CHAPTER = "Virtual";

export function isVirtualChapter(chapter: string | null | undefined): boolean {
  return chapter === VIRTUAL_CHAPTER;
}

// Virtual events and members with no local chapter fall back to Colorado's
// zone, same deliberate default as waiverStateForChapter in lib/waivers.ts
// (keep the two in sync).
const FALLBACK_TIMEZONE = "America/Denver";

/**
 * Distinct timezones the active chapters run events in, as select options
 * for the admin event editor — so an admin picks a zone by name, never a raw
 * UTC offset. Labeled with the chapters that use it, e.g. "Denver (Denver,
 * CO Springs)". `keep` (an event's current zone) is always included.
 */
export function timezoneOptions(
  chapters: Chapter[],
  keep?: string | null,
): { value: string; label: string }[] {
  const active = activeChapters(chapters);
  const zones = Array.from(new Set(active.map((c) => c.timezone)));
  if (zones.length === 0) zones.push(FALLBACK_TIMEZONE);
  if (keep && !zones.includes(keep)) zones.push(keep);
  return zones.map((timezone) => {
    const names = active.filter((c) => c.timezone === timezone).map((c) => c.name);
    const city = timezone.replace(/^[^/]+\//, "").replace(/_/g, " ");
    return { value: timezone, label: names.length > 0 ? `${city} (${names.join(", ")})` : city };
  });
}

/** The default timezone for a given chapter name — used to seed a new
 * event's timezone field, or as a fallback if an event's own timezone is
 * somehow unset. */
export function timezoneForChapter(chapter: string | null | undefined, chapters: Chapter[]): string {
  if (chapter === VIRTUAL_CHAPTER || chapter === NOT_LOCAL_CHAPTER) return FALLBACK_TIMEZONE;
  return (
    chapterByName(chapters, currentHomeChapterName(chapter))?.timezone ??
    activeChapters(chapters)[0]?.timezone ??
    FALLBACK_TIMEZONE
  );
}

/** The chapter names an admin can put an event in: every active chapter,
 * then Virtual. */
export function eventChapterNames(chapters: Chapter[]): string[] {
  return [...activeChapters(chapters).map((c) => c.name), VIRTUAL_CHAPTER];
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

/** A chapter's filter slug. The chapters table has a unique index on the
 * same expression, so no two chapters share one. */
export function chapterSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

/** The pills after "All": every active chapter in display order, then
 * Virtual. */
export function chapterFilterOptions(chapters: Chapter[]): ChapterFilterOption[] {
  return [
    ...activeChapters(chapters).map((c) => ({
      slug: chapterSlug(c.name),
      label: c.display_name ?? c.name,
      chapter: c.name,
    })),
    { slug: "virtual", label: "Virtual", chapter: VIRTUAL_CHAPTER },
  ];
}

/** A chapter filter selection: the selected pills' slugs, or null for All. */
export type ChapterSelection = string[] | null;

/**
 * The selection from the `?chapter=` param, or `defaultSelection` when
 * there's no param (or nothing recognisable in it).
 */
export function parseChapterSelection(
  param: string | null | undefined,
  defaultSelection: ChapterSelection,
  options: ChapterFilterOption[],
): ChapterSelection {
  if (param === "all") return null;
  const slugs = (param ?? "").split(",");
  const selected = options.filter((o) => slugs.includes(o.slug)).map((o) => o.slug);
  return selected.length > 0 ? selected : defaultSelection;
}

/** The participant list's default: the person's own chapter plus Virtual —
 * virtual events are open to everyone — or All with no local chapter. */
export function memberDefaultChapterSelection(
  profileChapter: string | null | undefined,
  options: ChapterFilterOption[],
): ChapterSelection {
  const own = options.find(
    (o) => o.chapter === profileChapter && !isVirtualChapter(o.chapter),
  );
  return own ? [own.slug, "virtual"] : null;
}

/** A selection of exactly these event chapters (e.g. a chapter lead's
 * led_chapters), or All when none of them has a pill. */
export function chapterSelectionFor(chapters: string[], options: ChapterFilterOption[]): ChapterSelection {
  const slugs = options.filter((o) => chapters.includes(o.chapter)).map((o) => o.slug);
  return slugs.length > 0 ? slugs : null;
}

/** The `?chapter=` value for a selection — always explicit, so a chosen
 * selection (All included) isn't replaced by the default on reload. */
export function chapterSelectionParam(selection: ChapterSelection): string {
  return selection && selection.length > 0 ? selection.join(",") : "all";
}

/** The selection after tapping one chapter pill: toggles it; turning off the
 * last one goes back to All. */
export function toggleChapterSelection(
  selection: ChapterSelection,
  slug: string,
  options: ChapterFilterOption[],
): ChapterSelection {
  const current = selection ?? [];
  const next = current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug];
  // Keep display order, so the URL is the same however it was built up.
  const ordered = options.map((o) => o.slug).filter((s) => next.includes(s));
  return ordered.length > 0 ? ordered : null;
}

/** The events.chapter values a selection matches, or null for All. */
export function selectedChapterNames(
  selection: ChapterSelection,
  options: ChapterFilterOption[],
): string[] | null {
  if (!selection) return null;
  return options.filter((o) => selection.includes(o.slug)).map((o) => o.chapter);
}

/** Whether an event's chapter passes the selection. */
export function matchesChapterSelection(
  selection: ChapterSelection,
  eventChapter: string | null,
  options: ChapterFilterOption[],
): boolean {
  if (!selection) return true;
  return options.some((o) => selection.includes(o.slug) && o.chapter === eventChapter);
}

/** "Denver and Virtual", "Atlanta, Rome and Virtual" — for empty-state copy. */
export function chapterSelectionLabel(selection: ChapterSelection, options: ChapterFilterOption[]): string {
  if (!selection) return "any chapter";
  const labels = options.filter((o) => selection.includes(o.slug)).map((o) => o.label);
  return labels.length > 1
    ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
    : labels[0];
}
