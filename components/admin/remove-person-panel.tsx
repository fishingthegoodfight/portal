"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  deletePersonAction,
  personRemovalPreviewAction,
  removePersonAccessAction,
} from "@/lib/actions/person-removal";
import { attachedLines, hasNothingAttached, type PersonRemovalPreview } from "@/lib/person-removal";
import { formatDateInZone } from "@/lib/format-date";
import { RevealPanel } from "@/components/reveal-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "Remove person…" on a People & roles row. Loads what's attached to them
 * first, then:
 *  - nothing attached: delete outright, confirmed by typing their email;
 *  - something attached: Remove access (history kept) is the offer, with a
 *    full delete as a separate, deliberate step that lists exactly what it
 *    destroys and also needs their email typed;
 *  - access already removed: only the full delete is left here (Restore
 *    access is on the row).
 * The database refuses yourself and the last admin whatever this shows.
 */
export function RemovePersonPanel({
  userId,
  label,
  onClose,
  onDeleted,
}: {
  userId: string;
  /** Their name, or email when unnamed. */
  label: string;
  onClose: () => void;
  /** After a delete — the row is about to disappear, so the message lives
   * with the parent. */
  onDeleted: (message: string) => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<PersonRemovalPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [typed, setTyped] = useState("");
  // One reason for whichever action is taken — it carries over if they
  // switch from Remove access to Delete.
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"access" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void personRemovalPreviewAction(userId).then((result) => {
      if (cancelled) return;
      if (result.ok) setPreview(result.preview);
      else setLoadError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const removeAccess = async () => {
    setBusy("access");
    setError(null);
    const result = await removePersonAccessAction(userId, reason);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onClose();
    router.refresh();
  };

  const deletePerson = async () => {
    setBusy("delete");
    setError(null);
    const result = await deletePersonAction(userId, typed, reason);
    if (!result.ok) {
      setBusy(null);
      setError(result.error);
      return;
    }
    onDeleted(result.warning ?? `${label} was deleted.`);
    router.refresh();
  };

  const shell = "mt-3 flex flex-col gap-3 rounded-md border p-3 text-sm";

  if (loadError || !preview) {
    return (
      <div className={shell}>
        {loadError ? (
          <p role="alert" className="text-red-700 dark:text-red-400">
            {loadError}
          </p>
        ) : (
          <p className="text-muted-foreground">Checking what&apos;s attached to {label}…</p>
        )}
        {loadError && (
          <div>
            <Button type="button" size="sm" variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>
    );
  }

  const c = preview.counts;
  const lines = attachedLines(c);
  const nothingAttached = hasNothingAttached(c);
  const blocked = preview.isSelf
    ? "You can't remove yourself. Another admin can do it."
    : preview.isLastAdmin
      ? "They're the only admin. Make someone else an admin first."
      : null;

  if (blocked) {
    return (
      <RevealPanel role="alert" className={shell}>
        <p>{blocked}</p>
        <div>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </RevealPanel>
    );
  }

  const emailMatches = typed.trim().toLowerCase() === preview.email.trim().toLowerCase();
  const confirmField = (
    <div className="grid gap-2">
      <Label htmlFor={`remove_person_confirm_${userId}`}>
        Type <strong>{preview.email}</strong> to confirm
      </Label>
      <Input
        id={`remove_person_confirm_${userId}`}
        autoComplete="off"
        spellCheck={false}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
    </div>
  );
  // Rendered in whichever section is open (only one action is ever on offer
  // at a time), so the same text follows the admin between them.
  const reasonField = (
    <div className="grid gap-2">
      <Label htmlFor={`remove_person_reason_${userId}`}>
        Reason <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <Textarea
        id={`remove_person_reason_${userId}`}
        rows={2}
        maxLength={1000}
        placeholder="e.g. Duplicate of their other account · Asked to be removed by email, Sep 29"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Kept in the Removed people list, so &ldquo;why was this person removed?&rdquo; has an answer
        later.
      </p>
    </div>
  );
  const errorLine = error && (
    <RevealPanel role="alert" revealKey={error} className="text-red-700 dark:text-red-400">
      {error}
    </RevealPanel>
  );
  const healthLogLine = c.health_access_log > 0 && (
    <p className="text-muted-foreground">
      {plural(c.health_access_log, "health access log entry", "health access log entries")} about or
      by them stay — that log can&apos;t be changed by anyone.
    </p>
  );

  // Nothing attached: straight to the delete.
  if (nothingAttached) {
    return (
      <RevealPanel
        aria-label={`Delete ${label}?`}
        className={`${shell} border-red-500/50 bg-red-500/10`}
      >
        <p>
          Nothing is attached to <strong>{label}</strong> — no RSVPs, volunteer shifts, waivers,
          health forms, application or volunteer record. Deleting removes their profile and login
          completely. It can&apos;t be undone.
        </p>
        {healthLogLine}
        {reasonField}
        {confirmField}
        {errorLine}
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={!emailMatches || busy !== null}
            onClick={() => void deletePerson()}
          >
            {busy === "delete" ? "Deleting..." : "Delete permanently"}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={onClose}>
            Never mind
          </Button>
        </div>
      </RevealPanel>
    );
  }

  const alreadyRemoved = preview.accessRemovedAt !== null;
  const alsoOnRemove = [
    c.rsvps_upcoming > 0 &&
      `their ${plural(c.rsvps_upcoming, "RSVP", "RSVPs")} to upcoming events ${
        c.rsvps_upcoming === 1 ? "is" : "are"
      } removed and the spots offered to the waitlist`,
    c.volunteer_signups_upcoming > 0 &&
      `their ${plural(c.volunteer_signups_upcoming, "upcoming volunteer shift is", "upcoming volunteer shifts are")} cancelled`,
    c.volunteer_applications_open > 0 && "their open volunteer application is withdrawn",
    preview.role !== "participant" && "their role goes back to participant",
    "any sensitive-data access is turned off",
  ].filter(Boolean) as string[];

  return (
    <RevealPanel aria-label={`Remove ${label}?`} revealKey={showDelete} className={shell}>
      <div>
        <p>
          <strong>{label}</strong> has history here:
        </p>
        <ul className="mt-1 list-disc pl-5">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      {alreadyRemoved ? (
        <p>
          Their access was removed on{" "}
          {formatDateInZone(preview.accessRemovedAt as string, "America/Denver")}. Use Restore access
          on their row to let them back in.
        </p>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
          <p className="font-medium">Remove access — recommended</p>
          <p>
            They can&apos;t sign in any more, and any session they have ends within the hour. They
            drop out of the volunteer registry and the event-lead picker. Everything above stays
            exactly as it is, so past rosters and attendance counts don&apos;t change.
          </p>
          <p>Also: {alsoOnRemove.join("; ")}. They aren&apos;t emailed.</p>
          <p className="text-muted-foreground">You can restore their access later.</p>
          {!showDelete && reasonField}
          {!showDelete && errorLine}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy !== null}
              onClick={() => void removeAccess()}
            >
              {busy === "access" ? "Removing..." : "Remove access"}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={onClose}>
              Never mind
            </Button>
          </div>
        </div>
      )}

      {!showDelete ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-red-500/60 text-red-700 hover:bg-red-500/10 dark:text-red-400"
            disabled={busy !== null}
            onClick={() => {
              setShowDelete(true);
              setTyped("");
              setError(null);
            }}
          >
            Delete everything instead…
          </Button>
          {alreadyRemoved && (
            <Button type="button" size="sm" variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            Only if they&apos;ve asked to be removed entirely.
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-red-500/50 bg-red-500/10 p-3">
          <p className="font-medium text-red-700 dark:text-red-400">Delete {label} permanently</p>
          <p>This destroys, for good:</p>
          <ul className="list-disc pl-5">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li>Their profile and login</li>
          </ul>
          <p>
            Past rosters and attendance counts change: the events they went to will no longer show
            them. It can&apos;t be undone.
          </p>
          {healthLogLine}
          {reasonField}
          {confirmField}
          {errorLine}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={!emailMatches || busy !== null}
              onClick={() => void deletePerson()}
            >
              {busy === "delete" ? "Deleting..." : "Delete permanently"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => {
                setShowDelete(false);
                setError(null);
              }}
            >
              Don&apos;t delete
            </Button>
          </div>
        </div>
      )}
    </RevealPanel>
  );
}
