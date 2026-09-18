"use client";

import { useState } from "react";

import { restoreEventAction } from "@/lib/actions/admin-event";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

export function RestoreEventDialog({
  eventId,
  eventName,
  confirmedCount,
  onRestored,
}: {
  eventId: number;
  eventName: string;
  /** Attendees with a confirmed RSVP — their rows are untouched by a
   * cancellation, so this is still accurate for deciding who to notify. */
  confirmedCount: number;
  onRestored: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [notify, setNotify] = useState(confirmedCount > 0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setIsOpen(true);
    setNotify(confirmedCount > 0);
    setError(null);
  };

  const close = () => {
    if (isLoading) return;
    setIsOpen(false);
  };

  const confirm = async () => {
    setIsLoading(true);
    setError(null);
    const result = await restoreEventAction(eventId, confirmedCount > 0 && notify);
    setIsLoading(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setIsOpen(false);
    onRestored();
  };

  if (!isOpen) {
    return <Button onClick={open}>Restore event</Button>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Restore {eventName}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            This makes the event visible to participants again and clears the cancellation
            reason.
          </p>
          {confirmedCount > 0 && (
            <label className="flex items-center gap-2 text-sm" htmlFor="restore_notify">
              <Checkbox
                id="restore_notify"
                checked={notify}
                onCheckedChange={(checked) => setNotify(checked === true)}
              />
              Email the {confirmedCount} confirmed{" "}
              {confirmedCount === 1 ? "attendee" : "attendees"} that it&apos;s back on, with a
              fresh calendar invite
            </label>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={isLoading}>
            Never mind
          </Button>
          <Button type="button" onClick={confirm} disabled={isLoading}>
            {isLoading ? "Restoring..." : "Restore event"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
