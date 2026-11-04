import { cn } from "@/lib/utils";

/**
 * A retreat's region as a small pill, where an event would show its
 * ChapterTag: retreats belong to a region, not a chapter.
 */
export function RegionTag({ region, className }: { region: string | null; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-green-700/40 bg-green-600/10 px-2 py-0.5 text-xs font-medium text-green-800 dark:text-green-400",
        className,
      )}
    >
      {region ? `${region} retreat` : "Retreat"}
    </span>
  );
}
