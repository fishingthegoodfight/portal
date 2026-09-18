"use client";

import { useState } from "react";

import {
  cancelEventAction,
  previewEventCancellationAction,
} from "@/lib/actions/admin-event";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type PreviewState = {
  subject: string;
  html: string;
  recipientCount: number;
};

export function CancelEventDialog({
  eventId,
  eventName,
  onCancelled,
}: {
  eventId: number;
  eventName: string;
  onCancelled: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setIsOpen(true);
    setReason("");
    setPreview(null);
    setError(null);
  };

  const close = () => {
    if (isLoading) return;
    setIsOpen(false);
  };

  const handlePreview = async () => {
    setIsLoading(true);
    setError(null);
    const result = await previewEventCancellationAction(eventId, reason);
    setIsLoading(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPreview({
      subject: result.subject,
      html: result.html,
      recipientCount: result.recipientCount,
    });
  };

  const handleConfirm = async () => {
    setIsLoading(true);
    setError(null);
    const result = await cancelEventAction(eventId, reason);
    setIsLoading(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setIsOpen(false);
    onCancelled();
  };

  if (!isOpen) {
    return (
      <Button variant="destructive" onClick={open}>
        Cancel event
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle>Cancel {eventName}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!preview ? (
            <div className="grid gap-2">
              <Label htmlFor="cancel_reason" className="font-semibold">
                This reason will be emailed to everyone registered
              </Label>
              <Textarea
                id="cancel_reason"
                required
                autoFocus
                placeholder="e.g. Venue flooding — we have to reschedule."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm">
                This will be emailed to{" "}
                <strong>
                  {preview.recipientCount} confirmed{" "}
                  {preview.recipientCount === 1 ? "attendee" : "attendees"}
                </strong>
                , each with a calendar update that clears the event.
              </p>
              <div className="rounded-md border">
                <div className="border-b bg-muted px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Subject: </span>
                  {preview.subject}
                </div>
                <iframe
                  title="Cancellation email preview"
                  srcDoc={preview.html}
                  sandbox=""
                  className="h-72 w-full"
                />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          {!preview ? (
            <>
              <Button type="button" variant="outline" onClick={close} disabled={isLoading}>
                Never mind
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handlePreview}
                disabled={isLoading || !reason.trim()}
              >
                {isLoading ? "Loading preview..." : "Preview cancellation email"}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPreview(null)}
                disabled={isLoading}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleConfirm}
                disabled={isLoading}
              >
                {isLoading ? "Cancelling..." : "Confirm cancellation"}
              </Button>
            </>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
