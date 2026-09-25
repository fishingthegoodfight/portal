"use client";

import { useState } from "react";
import Link from "next/link";
import { Flag } from "lucide-react";

import { recordHealthCheckinAnswerAction } from "@/lib/actions/health-history";
import type { HealthMarker, HealthStatus } from "@/lib/health-access";
import { Button } from "@/components/ui/button";

/** What the roster knows about health forms: `status` for every manager (no
 * health content), `markers` only for someone who passed the health check —
 * null for everyone else, who then sees no marker at all. */
export type RosterHealth = {
  status: Record<string, HealthStatus>;
  markers: Record<string, HealthMarker> | null;
};

/**
 * One person's health line on the roster:
 *  - "Health form outstanding" — to every manager, like the waiver pill.
 *  - A small flag linking to their form — only for health-access viewers,
 *    only when their form needs staff review or they said something
 *    changed at check-in. Never a label the participant could see.
 *  - Once they're checked in, the check-in question, recorded by whoever is
 *    checking them in. The checker only ever sees that it was answered.
 */
export function RosterHealthLine({
  eventId,
  userId,
  health,
  checkedIn,
}: {
  eventId: number;
  userId: string;
  health: RosterHealth;
  checkedIn: boolean;
}) {
  const status = health.status[userId];
  const marker = health.markers?.[userId];
  const [answered, setAnswered] = useState(status?.checkinAnswered ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status) return null;
  const flagged = marker && (marker.needsReview || marker.changedAtCheckin);

  const answer = async (changed: boolean) => {
    setSaving(true);
    setError(null);
    const result = await recordHealthCheckinAnswerAction(eventId, userId, changed);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAnswered(true);
  };

  return (
    <>
      {(status.required && !status.hasCurrent) || flagged ? (
        <span className="flex flex-wrap items-center gap-2">
          {status.required && !status.hasCurrent && (
            <span className="w-fit rounded bg-amber-500 px-2 py-0.5 text-xs font-bold tracking-wide text-white">
              HEALTH FORM OUTSTANDING
            </span>
          )}
          {flagged && (
            <Link
              href={`/protected/admin/events/${eventId}/health/${userId}`}
              title={[
                marker.needsReview && "Health form: needs staff review",
                marker.changedAtCheckin && "Said something changed at check-in",
              ]
                .filter(Boolean)
                .join(" · ")}
              aria-label="Health form flagged — open it"
              className="inline-flex items-center text-rose-600 hover:text-rose-700 dark:text-rose-400"
            >
              <Flag className="size-4" aria-hidden />
            </Link>
          )}
        </span>
      ) : null}

      {health.markers && status.hasCurrent && !flagged && (
        <Link
          href={`/protected/admin/events/${eventId}/health/${userId}`}
          className="w-fit text-xs text-muted-foreground underline underline-offset-4"
        >
          Health form
        </Link>
      )}

      {/* Only asked of someone with a form to have changed. */}
      {checkedIn && status.hasCurrent && (
        answered ? (
          <span className="text-xs text-muted-foreground">Health check-in question answered</span>
        ) : (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            Anything changed since you filled out your health form?
            <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => answer(true)}>
              Yes
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => answer(false)}>
              No
            </Button>
            {error && <span className="text-xs text-red-500">{error}</span>}
          </span>
        )
      )}
    </>
  );
}
