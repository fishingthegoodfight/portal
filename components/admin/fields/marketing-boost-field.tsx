"use client";

import { Checkbox } from "@/components/ui/checkbox";

/**
 * "Boost this event to Tier 1 marketing" — the one marketing decision on the
 * create wizard and edit form (events.marketing_tier = 1, or left unset).
 * Takes effect on save: no approval, no notification. The database allows
 * one Tier 1 event per chapter per calendar month (events_marketing_guard)
 * and names the event already holding the month if this one can't have it.
 */
export function MarketingBoostField({
  idPrefix,
  checked,
  onChange,
  disabledReason,
  note,
}: {
  idPrefix: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Shown instead of letting it change — e.g. an event's own lead, who can
   * edit the event but not its boost. */
  disabledReason?: string;
  /** An extra line under the help text, e.g. about series. */
  note?: string;
}) {
  const id = `${idPrefix}_boost`;
  return (
    <div className="flex items-start gap-2 rounded-md border p-3">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        disabled={Boolean(disabledReason)}
        onCheckedChange={(c) => onChange(c === true)}
      />
      <div className="grid gap-1">
        <label htmlFor={id} className="text-sm font-medium leading-none">
          Boost this event to Tier 1 marketing
        </label>
        <p className="text-xs text-muted-foreground">
          Tier 1 involves ad spend, so it&apos;s limited to one event per chapter per month.
        </p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
        {disabledReason && (
          <p className="text-xs text-amber-700 dark:text-amber-400">{disabledReason}</p>
        )}
      </div>
    </div>
  );
}
