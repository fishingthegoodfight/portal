import Link from "next/link";

import type { EventNeedingHealthForm } from "@/lib/health-requirements";
import { Button } from "@/components/ui/button";

/**
 * "Your health form is needed" — shown after an RSVP or volunteer signup
 * when there's no form on file for that event's year. A prompt, not a gate:
 * the RSVP stands either way, and the roster shows it as outstanding.
 */
export function HealthFormPrompt({
  events,
  next,
}: {
  events: EventNeedingHealthForm[];
  /** Where to come back to after submitting. */
  next: string;
}) {
  if (events.length === 0) return null;
  const now = events.filter((e) => !e.opensLater);
  const later = events.filter((e) => e.opensLater);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
      {now.length > 0 && (
        <>
          <p className="font-medium text-amber-800 dark:text-amber-300">
            Your {now[0].year} health form is needed for{" "}
            {now.length === 1 ? now[0].name : `${now.length} of your upcoming events`}.
          </p>
          <p className="text-muted-foreground">
            It takes about ten minutes, once a year. Only trained staff see it.
          </p>
          <div>
            <Button asChild size="sm">
              <Link href={`/protected/profile/medical/new?next=${encodeURIComponent(next)}`}>
                Complete your health form
              </Link>
            </Button>
          </div>
        </>
      )}
      {later.length > 0 && (
        <p className="text-muted-foreground">
          {later.map((e) => e.name).join(", ")} {later.length === 1 ? "is" : "are"} in {later[0].year}
          , so you&apos;ll need a {later[0].year} health form — it opens on January 1.
        </p>
      )}
    </div>
  );
}
