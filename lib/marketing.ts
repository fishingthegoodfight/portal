/**
 * Where an event can be marked as posted (event_marketing_posts.channel).
 * Only the website for now — adding Instagram, Facebook or the newsletter
 * means widening the table's check constraint and adding it here.
 */
export const MARKETING_CHANNELS = ["website"] as const;
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];

export const MARKETING_CHANNEL_LABELS: Record<MarketingChannel, string> = {
  website: "website",
};

/** The general description and this occurrence's note as one block — how
 * the marketing page shows and copies them. */
export function combinedDescription(
  description: string | null,
  occurrenceNote: string | null,
): string {
  return [description?.trim(), occurrenceNote?.trim()].filter(Boolean).join("\n\n");
}
