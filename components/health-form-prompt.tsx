import Link from "next/link";

import type { EventNeedingHealthForm } from "@/lib/health-requirements";
import { Button } from "@/components/ui/button";

/**
 * "Your health form is needed" — shown after an RSVP, a retreat
 * registration or a volunteer signup when no form on file covers the event
 * (a form covers events starting within 12 months of signing). A prompt, not a gate:
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
  const now = events.filter((e) => !e.opensOn);
  const later = events.filter((e) => e.opensOn);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
      {now.length > 0 && (
        <>
          <p className="font-medium text-amber-800 dark:text-amber-300">
            A health form is needed for{" "}
            {now.length === 1 ? now[0].name : `${now.length} of your upcoming events`}.
          </p>
          <p className="text-muted-foreground">
            It takes about ten minutes and covers your events for the next 12 months. Only trained staff see it.
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
        <ul className="flex flex-col gap-1 text-muted-foreground">
          {later.map((e) => (
            <li key={e.eventId}>
              {e.name} is more than 12 months away, so its health form can be filled in from {e.opensOn}.
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
