"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  deleteEventAction,
  deleteEventScopeAction,
  type LaterOccurrence,
} from "@/lib/actions/admin-event-delete";
import { CancelEventDialog } from "@/components/admin/cancel-event-dialog";
import { RevealPanel } from "@/components/reveal-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Scope = "this" | "future";

/**
 * "Delete event", set apart at the bottom of the Manage page. Only offered
 * when nobody has ever registered or volunteered (canDelete — the database's
 * admin_delete_event enforces the same rule); otherwise a line pointing to
 * Cancel instead. Confirming means typing the event's name. A series
 * occurrence also chooses between this one and this plus every later empty
 * occurrence.
 */
export function DeleteEventSection({
  eventId,
  eventName,
  seriesId,
  canDelete,
  isCancelled,
}: {
  eventId: number;
  eventName: string;
  seriesId: string | null;
  canDelete: boolean;
  isCancelled: boolean;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [later, setLater] = useState<{ deletable: LaterOccurrence[]; kept: LaterOccurrence[] } | null>(null);
  const [scope, setScope] = useState<Scope>("this");
  const [typed, setTyped] = useState("");
  const [isLoadingScope, setIsLoadingScope] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = typed.trim() === eventName.trim();

  const open = async () => {
    setIsOpen(true);
    setScope("this");
    setTyped("");
    setError(null);
    setLater(null);
    if (!seriesId) return;
    setIsLoadingScope(true);
    const result = await deleteEventScopeAction(eventId);
    setIsLoadingScope(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLater({ deletable: result.deletable, kept: result.kept });
  };

  const confirm = async () => {
    setIsDeleting(true);
    setError(null);
    const result = await deleteEventAction(eventId, scope === "future", typed);
    if (!result.ok) {
      setIsDeleting(false);
      setError(result.error);
      return;
    }
    // Stays "Deleting..." until the page is replaced.
    router.push(
      result.remainingSeriesId
        ? `/protected/admin/events/series/${result.remainingSeriesId}`
        : "/protected/admin",
    );
  };

  return (
    <section
      aria-labelledby="delete_event_heading"
      className="mt-6 flex flex-col gap-3 rounded-md border border-red-500/40 p-3"
    >
      <h2 id="delete_event_heading" className="text-sm font-semibold text-red-700 dark:text-red-400">
        Delete event
      </h2>

      {!canDelete ? (
        <p className="text-sm text-muted-foreground">
          Events with registrations or volunteer signups can&apos;t be deleted
          {isCancelled ? (
            " — this one is already cancelled."
          ) : (
            <>
              {" "}— they have to be{" "}
              <CancelEventDialog
                eventId={eventId}
                eventName={eventName}
                seriesId={seriesId}
                label="cancelled instead"
                triggerVariant="link"
                onCancelled={() => router.refresh()}
              />
              .
            </>
          )}
        </p>
      ) : !isOpen ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Nobody has registered or signed up to volunteer, so this event can be removed
            completely — it disappears from the admin list and its public page stops working.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 border-red-500/60 text-red-700 hover:bg-red-500/10 dark:text-red-400"
            onClick={() => void open()}
          >
            Delete event…
          </Button>
        </div>
      ) : (
        <RevealPanel
          aria-label={`Delete ${eventName}?`}
          revealKey={later ? "loaded" : "open"}
          className="flex flex-col gap-3 rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm"
        >
          <p>
            This permanently deletes <strong>{eventName}</strong>, its volunteer roles and its
            public page. It can&apos;t be undone.
          </p>

          {seriesId && isLoadingScope && <p className="text-muted-foreground">Checking the series…</p>}

          {seriesId && later && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-medium">This event is part of a series</legend>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="delete_scope"
                  className="mt-1"
                  checked={scope === "this"}
                  onChange={() => setScope("this")}
                />
                <span>Delete just this occurrence — the rest of the series is untouched.</span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="delete_scope"
                  className="mt-1"
                  checked={scope === "future"}
                  disabled={later.deletable.length === 0}
                  onChange={() => setScope("future")}
                />
                <span className={later.deletable.length === 0 ? "text-muted-foreground" : undefined}>
                  {later.deletable.length === 0 ? (
                    "Delete this and all later occurrences — there are no later ones without registrations."
                  ) : (
                    <>
                      Delete this and the {later.deletable.length} later{" "}
                      {later.deletable.length === 1 ? "occurrence" : "occurrences"} with no
                      registrations:{" "}
                      {later.deletable
                        .map((o) => (o.cancelled ? `${o.date} (cancelled)` : o.date))
                        .join(", ")}
                      .
                    </>
                  )}
                  {later.kept.length > 0 && (
                    <span className="block text-muted-foreground">
                      {later.kept.length} later{" "}
                      {later.kept.length === 1 ? "occurrence has" : "occurrences have"}{" "}
                      registrations and will be kept: {later.kept.map((o) => o.date).join(", ")}.
                    </span>
                  )}
                </span>
              </label>
            </fieldset>
          )}

          <div className="grid gap-2">
            <Label htmlFor="delete_event_confirm_name">
              Type <strong>{eventName}</strong> to confirm
            </Label>
            <Input
              id="delete_event_confirm_name"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>

          {error && (
            <RevealPanel role="alert" revealKey={error} className="text-red-700 dark:text-red-400">
              {error}
            </RevealPanel>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!matches || isDeleting || (Boolean(seriesId) && !later)}
              onClick={() => void confirm()}
            >
              {isDeleting
                ? "Deleting..."
                : scope === "future" && later
                  ? `Delete ${1 + later.deletable.length} events`
                  : "Delete event"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isDeleting}
              onClick={() => setIsOpen(false)}
            >
              Never mind
            </Button>
          </div>
        </RevealPanel>
      )}
    </section>
  );
}
