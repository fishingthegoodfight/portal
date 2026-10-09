"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { saveMembersEmailSettingsAction } from "@/lib/actions/members";
import { WEEKDAY_LABELS } from "@/lib/opportunities-schedule";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/** Setup → Members: the weekly outreach email (lib/members-outreach-email.ts). */
export function MembersEmailSettingsForm({
  enabled,
  weekday,
  roleTypeId,
  roleTypes,
}: {
  enabled: boolean;
  weekday: number;
  roleTypeId: number | null;
  /** The role types ticked Chapter leadership team. */
  roleTypes: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [day, setDay] = useState(String(weekday));
  const [role, setRole] = useState(roleTypeId == null ? "" : String(roleTypeId));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await saveMembersEmailSettingsAction({
      enabled: on,
      weekday: Number(day),
      roleTypeId: role ? Number(role) : null,
    });
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
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="members_email_role">Who gets each chapter&apos;s email</Label>
          <Select id="members_email_role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Choose a role…</option>
            {roleTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="members_email_day">Day</Label>
          <Select id="members_email_day" value={day} onChange={(e) => setDay(e.target.value)}>
            {WEEKDAY_LABELS.map((label, i) => (
              <option key={label} value={i}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Everyone approved for that role gets their home chapter&apos;s list, around 9am Mountain with the daily
        reminders. Only roles ticked &quot;Chapter leadership team&quot; (Volunteers → Role types) are offered, since
        that&apos;s what lets them open Members. If a day&apos;s run is missed, the next two days catch up.
      </p>
      {message && <p className={message.ok ? "text-sm text-green-700" : "text-sm text-red-500"}>{message.text}</p>}
      <Button type="submit" className="w-fit" disabled={busy}>
        {busy ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}
