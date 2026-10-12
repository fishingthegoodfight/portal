"use client";

import Link from "next/link";
import { useState } from "react";

import { EmailComposer } from "@/components/email-composer";
import { Button } from "@/components/ui/button";
import type { RosterPerson, VolunteerRosterPerson } from "@/lib/admin/roster";
import type { EventTiming } from "@/lib/event-timing";

type Audience = { key: string; label: string; userIds: string[]; note?: string };

/**
 * The roster's Email button: pick who (RSVP'd guests and volunteers
 * together, everyone RSVP'd, checked in only, no-shows, or the event's
 * volunteers), then write the message
 * (components/email-composer.tsx). The database checks the sender can
 * manage this event and each person is on it. Counts as outreach only for
 * people whose home chapter is the event's.
 */
export function RosterEmailButton({
  eventId,
  chapter,
  timing,
  roster,
  volunteerRoster,
}: {
  eventId: number;
  chapter: string | null;
  timing: EventTiming;
  roster: RosterPerson[];
  volunteerRoster: VolunteerRosterPerson[];
}) {
  const [choosing, setChoosing] = useState(false);
  const [audience, setAudience] = useState<Audience | null>(null);
  const [started] = useState(() => Date.now() >= new Date(timing.startsAt).getTime());

  const volunteerIds = [...new Set(volunteerRoster.map((v) => v.userId))];
  const audiences: Audience[] = [
    {
      key: "everyone",
      label: "RSVP'd and volunteers",
      userIds: [...new Set([...roster.map((p) => p.userId), ...volunteerIds])],
    },
    { key: "rsvp", label: "Everyone RSVP'd", userIds: roster.map((p) => p.userId) },
    { key: "checked_in", label: "Checked in only", userIds: roster.filter((p) => p.checkedInAt).map((p) => p.userId) },
    {
      key: "no_show",
      label: "No-shows",
      userIds: started ? roster.filter((p) => !p.checkedInAt).map((p) => p.userId) : [],
      note: started ? undefined : "after it starts",
    },
    { key: "volunteers", label: "Volunteers", userIds: volunteerIds },
  ];

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setChoosing((v) => !v)} aria-expanded={choosing}>
        Email…
      </Button>
      {choosing && (
        <div className="flex w-full flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2">
          <span className="text-sm text-muted-foreground">Email:</span>
          {audiences.map((a) => (
            <Button
              key={a.key}
              size="sm"
              variant="outline"
              disabled={a.userIds.length === 0}
              onClick={() => {
                setAudience(a);
                setChoosing(false);
              }}
            >
              {a.label} ({a.note ?? a.userIds.length})
            </Button>
          ))}
          <Link href={`/protected/emails?event=${eventId}`} className="text-sm underline underline-offset-4">
            Emails sent
          </Link>
        </div>
      )}
      {audience && (
        <EmailComposer
          source="roster"
          eventId={eventId}
          chapter={chapter}
          audience={audience.label}
          userIds={audience.userIds}
          onClose={() => setAudience(null)}
        />
      )}
    </>
  );
}
