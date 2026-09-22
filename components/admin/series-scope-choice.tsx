"use client";

import { useState } from "react";

import type { ScopeSummary } from "@/lib/actions/admin-event-series";
import type { EditScope, OccurrencePeople } from "@/lib/admin/series";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function peopleLabel(people: OccurrencePeople): string {
  const registered = people.confirmed + people.waiting;
  const parts = [
    `${registered} ${registered === 1 ? "registrant" : "registrants"}` +
      (people.waiting > 0 ? ` (${people.waiting} waitlisted)` : ""),
  ];
  if (people.volunteers > 0) {
    parts.push(`${people.volunteers} ${people.volunteers === 1 ? "volunteer" : "volunteers"}`);
  }
  return parts.join(", ");
}

/** "This event only" vs "This and all future events", with how many events
 * and people each reaches, confirmed before an edit or cancel of a series
 * occurrence goes through. */
export function SeriesScopeChoice({
  summary,
  action,
  busy,
  occurrenceNoteChanged = false,
  applyOccurrenceNote = false,
  onApplyOccurrenceNoteChange,
  onChoose,
  onBack,
}: {
  summary: ScopeSummary;
  action: "edit" | "cancel";
  busy: boolean;
  /** Edit only: offer to carry the occurrence note over too (it's
   * per-occurrence by design, so it's opt-in). */
  occurrenceNoteChanged?: boolean;
  applyOccurrenceNote?: boolean;
  onApplyOccurrenceNoteChange?: (value: boolean) => void;
  onChoose: (scope: EditScope) => void;
  onBack: () => void;
}) {
  const [choice, setChoice] = useState<EditScope>("this");
  const future = summary.future;
  const laterCount = future.eventCount - 1;

  const options: { value: EditScope; title: string; detail: string }[] = [
    {
      value: "this",
      title: "This event only",
      detail: `1 event · ${peopleLabel(summary.thisOnly.people)}`,
    },
    {
      value: "future",
      title: "This and all future events in the series",
      detail:
        laterCount === 0
          ? "No later scheduled events — same as this event only"
          : `${future.eventCount} events, through ${future.lastDate} · ${peopleLabel(future.people)}`,
    },
  ];

  return (
    <div
      role="alertdialog"
      className="flex flex-col gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
    >
      <p className="font-semibold">
        This event is part of a repeating series. {action === "edit" ? "Apply these changes to" : "Cancel"}:
      </p>
      <div className="flex flex-col gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-start gap-2 rounded-md border bg-background p-2",
              choice === option.value && "border-foreground",
            )}
          >
            <input
              type="radio"
              name="series_scope"
              className="mt-1"
              checked={choice === option.value}
              onChange={() => setChoice(option.value)}
            />
            <span className="flex flex-col">
              <span className="font-medium">{option.title}</span>
              <span className="text-muted-foreground">{option.detail}</span>
            </span>
          </label>
        ))}
      </div>

      {choice === "future" && action === "edit" && (
        <p className="text-muted-foreground">
          Only what you changed carries over: title, description, location or meeting link,
          capacity, lead contact, registration sections, time of day, and volunteer roles. Each
          event keeps its own date, and chapter, event type, and email note changes apply to this
          event only. Cancelled events in the series are left as they are.
        </p>
      )}
      {choice === "future" && action === "cancel" && (
        <p className="text-muted-foreground">
          Each event is cancelled and its confirmed attendees are emailed the reason. Events
          already cancelled are left as they are.
        </p>
      )}

      {choice === "future" && action === "edit" && occurrenceNoteChanged && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={applyOccurrenceNote}
            onChange={(e) => onApplyOccurrenceNoteChange?.(e.target.checked)}
          />
          Also apply the occurrence note to the future events
        </label>
      )}

      <div className="flex gap-2">
        <Button type="button" disabled={busy} onClick={() => onChoose(choice)}>
          {busy ? "Working..." : "Continue"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onBack}>
          Go back
        </Button>
      </div>
    </div>
  );
}
