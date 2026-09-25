"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { updateApplicationSettingsAction } from "@/lib/actions/volunteer-applications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Setup → Volunteer applications: the events-attended minimum and the
 * call-scheduling link. */
export function ApplicationSettingsForm({
  minEvents,
  schedulingUrl,
}: {
  minEvents: number;
  schedulingUrl: string;
}) {
  const router = useRouter();
  const [min, setMin] = useState(String(minEvents));
  const [url, setUrl] = useState(schedulingUrl);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const result = await updateApplicationSettingsAction({
      minEventsBeforeScreening: Number(min),
      screeningSchedulingUrl: url,
    });
    setSaving(false);
    setMessage(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error });
    if (result.ok) router.refresh();
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      <div className="grid gap-2 sm:max-w-xs">
        <Label htmlFor="settings_min_events">Events attended before a screening call</Label>
        <Input id="settings_min_events" type="number" min={0} value={min} onChange={(e) => setMin(e.target.value)} />
        <p className="text-xs text-muted-foreground">
          Applications below this land in Waiting on attendance, and move to Ready to screen by
          themselves once the person reaches it. Lowering it releases anyone who&apos;s now over.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="settings_scheduling_url">Call scheduling link</Label>
        <Input
          id="settings_scheduling_url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://calendar.app.google/…"
        />
        <p className="text-xs text-muted-foreground">
          Paste the booking page link from a Google Calendar appointment schedule. It goes in the
          &ldquo;Invite to schedule a call&rdquo; email.
        </p>
      </div>
      {message && <p className={message.ok ? "text-sm text-green-600" : "text-sm text-red-500"}>{message.text}</p>}
      <div>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}
