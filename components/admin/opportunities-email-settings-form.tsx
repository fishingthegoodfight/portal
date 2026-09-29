"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { updateOpportunitiesEmailSettingsAction } from "@/lib/actions/opportunities-email-settings";
import { nextSendDates, WEEKDAY_LABELS } from "@/lib/opportunities-schedule";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const longDate = (date: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );

/** Setup → Volunteer opportunities email. */
export function OpportunitiesEmailSettingsForm({
  enabled,
  anchor,
  weekday,
  today,
}: {
  enabled: boolean;
  anchor: string;
  weekday: number;
  /** Today's Denver date, YYYY-MM-DD — computed on the server. */
  today: string;
}) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [anchorDate, setAnchorDate] = useState(anchor);
  const [day, setDay] = useState(String(weekday));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const upcoming = /^\d{4}-\d{2}-\d{2}$/.test(anchorDate)
    ? nextSendDates({ anchor: anchorDate, weekday: Number(day) }, today, 4)
    : [];

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const result = await updateOpportunitiesEmailSettingsAction({
      enabled: on,
      anchor: anchorDate,
      weekday: Number(day),
    });
    setSaving(false);
    setMessage(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error });
    if (result.ok) router.refresh();
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      <label htmlFor="opportunities_enabled" className="flex items-start gap-2 text-sm">
        <Checkbox
          id="opportunities_enabled"
          className="mt-0.5"
          checked={on}
          onCheckedChange={(checked) => setOn(checked === true)}
        />
        <span className="flex flex-col gap-1">
          <span className="font-medium">Send the volunteer opportunities email</span>
          <span className="text-muted-foreground">
            Off: nothing is sent, including the finish-registration reminder.
          </span>
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="opportunities_weekday">Day</Label>
          <Select id="opportunities_weekday" value={day} onChange={(e) => setDay(e.target.value)}>
            {WEEKDAY_LABELS.map((label, i) => (
              <option key={label} value={i}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="opportunities_anchor">In the week of</Label>
          <Input
            id="opportunities_anchor"
            type="date"
            required
            value={anchorDate}
            onChange={(e) => setAnchorDate(e.target.value)}
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        It goes out on that day of the week containing the date (Sunday to Saturday), then every
        two weeks — around 9am Mountain, 11am Eastern, with the daily reminders. To skip a week or
        shift the rhythm, pick a date in the week you want it to go out. If a day&apos;s run doesn&apos;t
        reach everyone (it stops before the server&apos;s time limit, and at 250 emails to stay well
        under Google&apos;s daily sending cap), the following days&apos; runs send the rest.
      </p>
      {upcoming.length > 0 && (
        <div className="text-sm">
          <span className="font-medium">{on ? "Next sends" : "Would send"}:</span>{" "}
          <span className="text-muted-foreground">{upcoming.map(longDate).join(" · ")}</span>
        </div>
      )}
      {message && <p className={message.ok ? "text-sm text-green-600" : "text-sm text-red-500"}>{message.text}</p>}
      <div>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}
