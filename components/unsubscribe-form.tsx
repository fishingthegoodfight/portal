"use client";

import { useState } from "react";

import { setEmailListByTokenAction } from "@/lib/actions/unsubscribe";
import { Button } from "@/components/ui/button";
import type { EmailList } from "@/lib/email-preferences";

const COPY: Record<
  EmailList,
  { title: string; on: (email: string) => string; off: (email: string) => string; offButton: string; elsewhere: string }
> = {
  opportunities: {
    title: "Volunteer opportunities email",
    on: (email) =>
      `Every two weeks we email ${email} the open volunteer roles you're approved for near you. Turn it off?`,
    off: (email) =>
      `We won't send ${email} the volunteer opportunities email. Shift confirmations and reminders still come as usual.`,
    offButton: "Unsubscribe",
    elsewhere: "You can also change this on your profile, under Volunteering.",
  },
  chapter: {
    title: "Chapter emails",
    on: (email) =>
      `Chapter leads sometimes email ${email} news and invitations from your chapter or from an event you came to. Stop these?`,
    off: (email) =>
      `We won't send ${email} chapter emails. Emails about events you've signed up for (confirmations, reminders, changes and cancellations) still come as usual.`,
    offButton: "Stop chapter emails",
    elsewhere: "You can also change this on your profile.",
  },
};

/** Turn one email list off — or back on — from an email's footer link,
 * without signing in. */
export function UnsubscribeForm({
  token,
  list,
  maskedEmail,
  initiallySubscribed,
}: {
  token: string;
  list: EmailList;
  maskedEmail: string;
  initiallySubscribed: boolean;
}) {
  const [subscribed, setSubscribed] = useState(initiallySubscribed);
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[list];

  const set = async (next: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const result = await setEmailListByTokenAction(token, list, next);
      if (!result.ok) {
        setError("That didn't save — please try again.");
        return;
      }
      setSubscribed(next);
      setChanged(true);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{copy.title}</h1>
      {subscribed ? (
        <>
          <p className="text-sm">
            {changed ? "You're subscribed again. " : ""}
            {copy.on(maskedEmail)}
          </p>
          <div>
            <Button type="button" disabled={saving} onClick={() => set(false)}>
              {saving ? "Saving..." : copy.offButton}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm">
            {changed ? "Done — you're unsubscribed. " : "You're unsubscribed. "}
            {copy.off(maskedEmail)}
          </p>
          <div>
            <Button type="button" variant="outline" disabled={saving} onClick={() => set(true)}>
              {saving ? "Saving..." : "Turn it back on"}
            </Button>
          </div>
        </>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      <p className="text-xs text-muted-foreground">{copy.elsewhere}</p>
    </div>
  );
}
