"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { TIMEZONE_OPTIONS } from "@/lib/chapters";

/**
 * The date/start-time/end-time/timezone block shared by the admin event
 * create and edit forms — so "never ask the admin to think in UTC" stays
 * true in exactly one place.
 *
 * Two behaviors the two forms need differently, both controlled by props
 * rather than forking the component:
 * - `timezoneDerived`: the create wizard derives the zone from the chosen
 *   chapter and shows it as plain text with an "Override" link that reveals
 *   the select (edit always shows the select directly, since there's no
 *   "derive from" step there).
 * End time is optional on both forms: blank means an open-ended event
 * (`ends_at` stays null).
 */
export function DateTimeFields({
  idPrefix,
  date,
  time,
  endTime,
  timezone,
  onChangeDate,
  onChangeTime,
  onChangeEndTime,
  onChangeTimezone,
  timezoneDerived = false,
  onOverrideTimezone,
}: {
  idPrefix: string;
  date: string;
  time: string;
  endTime: string;
  timezone: string;
  onChangeDate: (value: string) => void;
  onChangeTime: (value: string) => void;
  onChangeEndTime: (value: string) => void;
  onChangeTimezone: (value: string) => void;
  timezoneDerived?: boolean;
  /** Fires once, the moment the admin clicks "Override" — lets a caller
   * that was auto-deriving `timezone` from something else (the create
   * wizard, from the chosen chapter) know to stop clobbering it. */
  onOverrideTimezone?: () => void;
}) {
  const [overriding, setOverriding] = useState(false);
  const showSelect = !timezoneDerived || overriding;
  const timezoneLabel = TIMEZONE_OPTIONS.find((tz) => tz.value === timezone)?.label ?? timezone;

  // Each cell is `content-start`: the end-time cell is taller (it carries a
  // helper line), and grid items stretch to the row height, so without it the
  // start-time cell's rows would spread apart and drop its input below the
  // end-time input.
  return (
    <div className="grid grid-cols-2 gap-4 rounded-md border p-3">
      <div className="col-span-2 text-sm font-medium">When</div>
      <div className="grid content-start gap-2">
        <Label htmlFor={`${idPrefix}_date`}>Date</Label>
        <Input
          id={`${idPrefix}_date`}
          type="date"
          required
          value={date}
          onChange={(e) => onChangeDate(e.target.value)}
        />
      </div>
      <div className="grid content-start gap-2">
        <Label htmlFor={`${idPrefix}_timezone`}>Time zone</Label>
        {showSelect ? (
          <Select
            id={`${idPrefix}_timezone`}
            required
            value={timezone}
            onChange={(e) => onChangeTimezone(e.target.value)}
          >
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </Select>
        ) : (
          <div className="flex h-9 items-center gap-2">
            <span className="text-sm">{timezoneLabel}</span>
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-4"
              onClick={() => {
                setOverriding(true);
                onOverrideTimezone?.();
              }}
            >
              Override
            </button>
          </div>
        )}
      </div>
      <div className="grid content-start gap-2">
        <Label htmlFor={`${idPrefix}_time`}>Start time</Label>
        <Input
          id={`${idPrefix}_time`}
          type="time"
          required
          value={time}
          onChange={(e) => onChangeTime(e.target.value)}
        />
      </div>
      <div className="grid content-start gap-2">
        <Label htmlFor={`${idPrefix}_end_time`}>End time</Label>
        <Input
          id={`${idPrefix}_end_time`}
          type="time"
          placeholder="Optional"
          value={endTime}
          onChange={(e) => onChangeEndTime(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">Leave blank for an open-ended event.</span>
      </div>
    </div>
  );
}
