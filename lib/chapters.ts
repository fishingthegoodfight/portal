export type Chapter = {
  name: string;
  /** USPS 2-letter code — shown alongside the chapter name, e.g. "Atlanta, GA". */
  state: string;
};

// Keep sorted alphabetically by name — this order is shown as-is in chapter
// dropdowns. Add new chapters here as they launch.
export const CHAPTERS: Chapter[] = [
  { name: "Atlanta", state: "GA" },
  { name: "CO Springs", state: "CO" },
  { name: "Denver", state: "CO" },
  { name: "Rome", state: "GA" },
];

// Stored in profiles.chapter for members not local to any chapter above.
export const NOT_LOCAL_CHAPTER = "Not local to a chapter";
