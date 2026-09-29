"use client";

import { useState } from "react";

import { setOpportunitiesEmailByTokenAction } from "@/lib/actions/unsubscribe";
import { Button } from "@/components/ui/button";

/** Turn the volunteer opportunities email off — or back on — from the
 * email's footer link, without signing in. */
export function UnsubscribeForm({
  token,
  maskedEmail,
  initiallySubscribed,
}: {
  token: string;
  maskedEmail: string;
  initiallySubscribed: boolean;
}) {
  const [subscribed, setSubscribed] = useState(initiallySubscribed);
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = async (next: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const result = await setOpportunitiesEmailByTokenAction(token, next);
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
      <h1 className="text-2xl font-bold">Volunteer opportunities email</h1>
      {subscribed ? (
        <>
          <p className="text-sm">
            {changed ? "You're subscribed again. " : ""}
            Every two weeks we email {maskedEmail} the open volunteer roles you&apos;re approved for near
            you. Turn it off?
          </p>
          <div>
            <Button type="button" disabled={saving} onClick={() => set(false)}>
              {saving ? "Saving..." : "Unsubscribe"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm">
            {changed ? "Done — you're unsubscribed. " : "You're unsubscribed. "}
            We won&apos;t send {maskedEmail} the volunteer opportunities email. Shift confirmations and
            reminders still come as usual.
          </p>
          <div>
            <Button type="button" variant="outline" disabled={saving} onClick={() => set(true)}>
              {saving ? "Saving..." : "Turn it back on"}
            </Button>
          </div>
        </>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      <p className="text-xs text-muted-foreground">
        You can also change this on your profile, under Volunteering.
      </p>
    </div>
  );
}
