"use client";

import { useState } from "react";

import {
  cancelEventAction,
  previewEventCancellationAction,
} from "@/lib/actions/admin-event";
import { seriesScopeSummaryAction, type ScopeSummary } from "@/lib/actions/admin-event-series";
import type { EditScope } from "@/lib/admin/series";
import { SeriesScopeChoice } from "@/components/admin/series-scope-choice";
import { RevealPanel } from "@/components/reveal-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type PreviewState = {
  subject: string;
  html: string;
  recipientCount: number;
  volunteerCount: number;
  eventCount: number;
  eventDates: string[];
};

export function CancelEventDialog({
  eventId,
  eventName,
  seriesId = null,
  initialScope = null,
  label = "Cancel event",
  onCancelled,
}: {
  eventId: number;
  eventName: string;
  /** Set for a series occurrence — the dialog then asks "This event only"
   * vs "This and all future events" before the preview. */
  seriesId?: string | null;
  /** Skip the question with this answer (the series page's "Cancel all
   * upcoming"). */
  initialScope?: EditScope | null;
  label?: string;
  onCancelled: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopePrompt, setScopePrompt] = useState<ScopeSummary | null>(null);
  const [scope, setScope] = useState<EditScope | null>(initialScope);

  const open = () => {
    setIsOpen(true);
    setReason("");
    setPreview(null);
    setError(null);
    setScopePrompt(null);
    setScope(initialScope);
  };

  const close = () => {
    if (isLoading) return;
    setIsOpen(false);
  };

  const handlePreview = async (chosenScope: EditScope | null = scope) => {
    setIsLoading(true);
    setError(null);

    if (seriesId && chosenScope == null) {
      const summary = await seriesScopeSummaryAction(eventId);
      setIsLoading(false);
      if (!summary.ok) {
        setError(summary.error);
        return;
      }
      setScopePrompt(summary);
      return;
    }

    const result = await previewEventCancellationAction(eventId, reason, chosenScope ?? "this");
    setIsLoading(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPreview({
      subject: result.subject,
      html: result.html,
      recipientCount: result.recipientCount,
      volunteerCount: result.volunteerCount,
      eventCount: result.eventCount,
      eventDates: result.eventDates,
    });
  };

  const handleConfirm = async () => {
    setIsLoading(true);
    setError(null);
    const result = await cancelEventAction(eventId, reason, scope ?? "this");
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
        {label}
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      {/* Focus moves into the dialog, and again at each step (scope → reason →
        * preview), so keyboard users land on what just appeared. */}
      <RevealPanel
        role="dialog"
        aria-modal="true"
        aria-label={`Cancel ${eventName}`}
        revealKey={scopePrompt ? "scope" : preview ? "preview" : "reason"}
        className="w-full max-w-lg"
      >
        <Card className="max-h-[90vh] overflow-y-auto">
          <CardHeader>
            <CardTitle>Cancel {eventName}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {scopePrompt ? (
              <SeriesScopeChoice
                summary={scopePrompt}
                action="cancel"
                busy={isLoading}
                onChoose={(choice) => {
                  setScope(choice);
                  setScopePrompt(null);
                  void handlePreview(choice);
                }}
                onBack={() => setScopePrompt(null)}
              />
            ) : !preview ? (
              <div className="grid gap-2">
                <Label htmlFor="cancel_reason" className="font-semibold">
                  This reason will be emailed to everyone registered and every volunteer signed up
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
                {preview.eventCount > 1 && (
                  <p className="text-sm">
                    This cancels <strong>{preview.eventCount} events</strong>:{" "}
                    {preview.eventDates.join(", ")}.
                  </p>
                )}
                <p className="text-sm">
                  The reason will be emailed to{" "}
                  <strong>
                    {preview.recipientCount} confirmed{" "}
                    {preview.recipientCount === 1 ? "attendee" : "attendees"}
                  </strong>
                  {preview.eventCount > 1 && " across those events (each gets their own event's date)"}
                  , each with a calendar update that clears the event.
                </p>
                <p className="text-sm">
                  {preview.volunteerCount > 0 ? (
                    <>
                      <strong>
                        {preview.volunteerCount} volunteer{" "}
                        {preview.volunteerCount === 1 ? "signup" : "signups"}
                      </strong>{" "}
                      will be cancelled too. Each volunteer is emailed the same reason with a
                      calendar update that clears their shift. Restoring the event later
                      won&apos;t bring their shifts back.
                    </>
                  ) : (
                    "No volunteers are signed up."
                  )}
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

            {error && (
              <RevealPanel role="alert" revealKey={error} className="text-sm text-red-500">
                {error}
              </RevealPanel>
            )}
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            {scopePrompt ? null : !preview ? (
              <>
                <Button type="button" variant="outline" onClick={close} disabled={isLoading}>
                  Never mind
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void handlePreview()}
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
                  onClick={() => {
                    setPreview(null);
                    // Ask the scope again on the next preview, unless it was fixed.
                    setScope(initialScope);
                  }}
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
      </RevealPanel>
    </div>
  );
}
