"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { saveMemberSettingsAction } from "@/lib/actions/members";
import type { MemberSettings } from "@/lib/members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const GROUPS: { title: string; fields: { key: keyof MemberSettings; label: string; unit: string }[] }[] = [
  {
    title: "Engagement bands",
    fields: [
      { key: "newDays", label: "New: first check-in within", unit: "days" },
      { key: "activeDays", label: "Active: a check-in within", unit: "days" },
      { key: "droppedDays", label: "Dropped: no check-in for", unit: "days (Quiet is between Active and this)" },
    ],
  },
  {
    title: "When someone needs a touch",
    fields: [
      { key: "touchNewDays", label: "New: within", unit: "days of their last check-in or touch" },
      { key: "touchActiveDays", label: "Active: every", unit: "days" },
      { key: "touchQuietFirstDays", label: "Quiet: within", unit: "days of becoming Quiet" },
      { key: "touchQuietRepeatDays", label: "Quiet: then every", unit: "days" },
      { key: "touchDroppedDays", label: "Dropped: every", unit: "days" },
    ],
  },
  {
    title: "Drop alerts",
    fields: [
      { key: "regularCheckins", label: "A regular has at least", unit: "check-ins in the 6 months before their last one" },
      { key: "dropAlertDays", label: "Alert when a regular has had no check-in for", unit: "days" },
    ],
  },
];

/** Setup → Members: the thresholds lib/members.ts works from. */
export function MemberSettingsForm({ initial }: { initial: MemberSettings }) {
  const router = useRouter();
  const [values, setValues] = useState<MemberSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await saveMemberSettingsAction(values);
    setBusy(false);
    setMessage(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error });
    if (result.ok) router.refresh();
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      {GROUPS.map((group) => (
        <fieldset key={group.title} className="flex flex-col gap-3">
          <legend className="mb-1 font-semibold">{group.title}</legend>
          {group.fields.map((f) => (
            <div key={f.key} className="flex flex-wrap items-center gap-2 text-sm">
              <Label htmlFor={`ms_${f.key}`}>{f.label}</Label>
              <Input
                id={`ms_${f.key}`}
                type="number"
                min={1}
                max={3650}
                required
                className="w-20"
                value={values[f.key]}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))}
              />
              <span className="text-muted-foreground">{f.unit}</span>
            </div>
          ))}
        </fieldset>
      ))}
      {message && <p className={message.ok ? "text-sm text-green-700" : "text-sm text-red-500"}>{message.text}</p>}
      <Button type="submit" className="w-fit" disabled={busy}>
        {busy ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}
