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
