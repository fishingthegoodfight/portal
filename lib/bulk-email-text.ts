import { NOT_LOCAL_CHAPTER, VIRTUAL_CHAPTER } from "@/lib/chapters";

/**
 * The text side of Members and roster emails (lib/bulk-email.ts sends
 * them): merge fields, the signature, and the event date — shared by the
 * compose screen's preview and the background sender, so what's previewed
 * is what goes out. No server imports: the compose screen runs this too.
 */

export const SUBJECT_MAX = 200;
export const BODY_MAX = 10000;

export type BulkEmailSource = "members" | "roster";

/** Merge fields, by source. Roster emails add the event's. */
export const MERGE_FIELDS: Record<BulkEmailSource, { key: string; label: string }[]> = {
  members: [
    { key: "first_name", label: "First name" },
    { key: "chapter", label: "Chapter" },
  ],
  roster: [
    { key: "first_name", label: "First name" },
    { key: "chapter", label: "Chapter" },
    { key: "event_name", label: "Event name" },
    { key: "event_date", label: "Event date" },
  ],
};

export type MergeValues = Partial<Record<"first_name" | "chapter" | "event_name" | "event_date", string | null>>;

/** {first_name} etc. replaced; an empty value falls back to something that
 * still reads ("there" for a missing first name). Unknown {fields} are left
 * as typed. */
export function applyMerge(text: string, values: MergeValues): string {
  const fallback: Record<string, string> = { first_name: "there", chapter: "your chapter" };
  return text.replace(/\{(first_name|chapter|event_name|event_date)\}/g, (_match, key: keyof MergeValues) => {
    const value = values[key]?.trim();
    return value || fallback[key] || "";
  });
}

/** A chapter that reads as one in a signature: not "Virtual" or "No local
 * chapter", and not none. */
export function signatureChapter(chapter: string | null | undefined): string | null {
  const c = chapter?.trim();
  return c && c !== VIRTUAL_CHAPTER && c !== NOT_LOCAL_CHAPTER ? c : null;
}

/** The signature's two lines: the sender, then "Denver chapter · Fishing
 * the Good Fight" (or just the organisation). */
export function signatureLines(senderName: string, chapter: string | null | undefined): [string, string] {
  const c = signatureChapter(chapter);
  return [senderName, c ? `${c} chapter · Fishing the Good Fight` : "Fishing the Good Fight"];
}

/** {event_date}: "Sat, Oct 17" in the event's own timezone. */
export function eventDateLabel(startsAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone }).format(
    new Date(startsAt),
  );
}
