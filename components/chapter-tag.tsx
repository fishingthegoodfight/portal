import { isVirtualChapter } from "@/lib/chapters";
import { cn } from "@/lib/utils";

/**
 * The event's chapter as a small pill, shown alongside the date/time/location
 * metadata wherever an event is summarized (event card, admin events index,
 * public event page) — the top-right of a card is left for status pills only.
 */
export function ChapterTag({ chapter, className }: { chapter: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      {isVirtualChapter(chapter) ? "Virtual" : `${chapter} chapter`}
    </span>
  );
}
