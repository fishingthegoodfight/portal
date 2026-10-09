"use client";

import { useState } from "react";

import { agoLabel, TOUCH_TYPE_LABELS, type TouchType } from "@/lib/members";
import { formatCertDate } from "@/lib/certifications";
import { LogOutreachForm } from "@/components/log-outreach-form";
import { Button } from "@/components/ui/button";

export type OutreachEntry = {
  id: number;
  on: string;
  type: string;
  by: string;
  note: string | null;
};

/** The contact profile's outreach: Log outreach, then every logged one,
 * newest first. Logged outreach can't be edited or deleted. */
export function PersonOutreach({
  memberId,
  today,
  entries,
}: {
  memberId: string;
  today: string;
  entries: OutreachEntry[];
}) {
  const [logging, setLogging] = useState(false);
  return (
    <div className="flex flex-col gap-3 text-sm">
      {logging ? (
        <LogOutreachForm memberId={memberId} today={today} onDone={() => setLogging(false)} />
      ) : (
        <Button size="sm" variant="outline" className="w-fit" onClick={() => setLogging(true)}>
          Log outreach
        </Button>
      )}
      {entries.length === 0 ? (
        <p className="text-muted-foreground">No outreach logged yet.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {entries.map((e) => (
            <li key={e.id} className="py-2">
              <span className="font-medium">{formatCertDate(e.on)}</span>
              <span className="text-muted-foreground">
                {" "}
                ({agoLabel(e.on, today)}) · {TOUCH_TYPE_LABELS[e.type as TouchType] ?? e.type} · {e.by}
              </span>
              {e.note && <span className="block whitespace-pre-line">{e.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
