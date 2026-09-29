/** The time zones a chapter can be given in Setup — the US zones, by the
 * name people know them by. The database accepts any IANA zone
 * (chapters_validate); this just keeps the picker short. */
export const CHAPTER_TIMEZONES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Mountain, no DST (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
];

export function chapterTimezoneLabel(value: string): string {
  return CHAPTER_TIMEZONES.find((tz) => tz.value === value)?.label ?? value;
}
