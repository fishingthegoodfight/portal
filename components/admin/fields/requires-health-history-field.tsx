"use client";

import { Checkbox } from "@/components/ui/checkbox";

/**
 * events.requires_health_history (and the event type default that
 * pre-ticks it): everyone at the event — participants and volunteers alike —
 * needs a current-year health form. The one rule; role makes no difference.
 */
export function RequiresHealthHistoryField({
  idPrefix,
  checked,
  onChange,
}: {
  idPrefix: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = `${idPrefix}_requires_health_history`;
  return (
    <div className="flex items-start gap-2 rounded-md border p-3">
      <Checkbox id={id} className="mt-0.5" checked={checked} onCheckedChange={(c) => onChange(c === true)} />
      <div className="grid gap-1">
        <label htmlFor={id} className="text-sm font-medium leading-none">
          Requires health history
        </label>
        <p className="text-xs text-muted-foreground">
          Everyone at this event — participants and volunteers — needs this year&apos;s health
          form. Turn it on for retreats and anything on the water.
        </p>
      </div>
    </div>
  );
}
