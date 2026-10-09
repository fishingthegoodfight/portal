"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { saveMembersEmailSettingsAction } from "@/lib/actions/members";
import { WEEKDAY_LABELS } from "@/lib/opportunities-schedule";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/** One chapter's row: who gets its email, from who can open it on Members. */
export type OutreachChapterChoice = {
  chapter: string;
  /** The profile id picked now, or "". */
  recipient: string;
  candidates: { userId: string; name: string }[];
};

/** Setup → Members: the weekly outreach email (lib/members-outreach-email.ts). */
export function MembersEmailSettingsForm({
  enabled,
  weekday,
  chapters,
}: {
  enabled: boolean;
  weekday: number;
  chapters: OutreachChapterChoice[];
}) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [day, setDay] = useState(String(weekday));
  const [recipients, setRecipients] = useState<Record<string, string>>(
    Object.fromEntries(chapters.map((c) => [c.chapter, c.recipient])),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await saveMembersEmailSettingsAction({ enabled: on, weekday: Number(day), recipients });
    setBusy(false);
    setMessage(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error });
    if (result.ok) router.refresh();
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      <label htmlFor="members_email_enabled" className="flex items-start gap-2 text-sm">
        <Checkbox
          id="members_email_enabled"
          className="mt-0.5"
          checked={on}
          onCheckedChange={(checked) => setOn(checked === true)}
        />
        <span className="flex flex-col gap-1">
          <span className="font-medium">Send the weekly outreach email</span>
          <span className="text-muted-foreground">Off: nothing is sent, to the chapters or the admins.</span>
        </span>
      </label>
      <div className="grid gap-2 sm:max-w-xs">
        <Label htmlFor="members_email_day">Day</Label>
        <Select id="members_email_day" value={day} onChange={(e) => setDay(e.target.value)}>
          {WEEKDAY_LABELS.map((label, i) => (
            <option key={label} value={i}>
              {label}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">
          Around 9am Mountain, with the daily reminders. If a day&apos;s run is missed, the next two days catch up.
        </p>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Who gets each chapter&apos;s email</legend>
        {chapters.map((c) => (
          <div key={c.chapter} className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:items-center sm:gap-3">
            <Label htmlFor={`outreach_to_${c.chapter}`}>{c.chapter}</Label>
            <Select
              id={`outreach_to_${c.chapter}`}
              value={recipients[c.chapter] ?? ""}
              onChange={(e) => setRecipients((prev) => ({ ...prev, [c.chapter]: e.target.value }))}
            >
              <option value="">Nobody (the admins get its list)</option>
              {c.candidates.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          The people who can open that chapter on Members: its chapter leads (People &amp; roles), and anyone on its
          leadership team. Someone picked who later stops leading the chapter isn&apos;t sent it, and the admins&apos;
          summary says so.
        </p>
      </fieldset>
      {message && <p className={message.ok ? "text-sm text-green-700" : "text-sm text-red-500"}>{message.text}</p>}
      <Button type="submit" className="w-fit" disabled={busy}>
        {busy ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}
