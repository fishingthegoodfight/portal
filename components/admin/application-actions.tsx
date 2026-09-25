"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  allowReapplicationAction,
  declineApplicationAction,
  sendApplicationEmailAction,
  setAttendanceCreditAction,
  withdrawApplicationAction,
  type ApplicationActionResult,
} from "@/lib/actions/volunteer-applications";
import type { ApplicationStatus } from "@/lib/volunteer-applications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Pending = "invite" | "attend_more" | "decline" | "reapply" | "withdraw" | null;

/**
 * The review actions. Nothing happens automatically: the attendance count
 * suggests which email fits, and the reviewer chooses. Both emails are one
 * click after a confirm; declining (admins only) takes an optional internal
 * reason and sends nothing. A declined application stays shut to the
 * applicant until an admin chooses "Allow re-application".
 */
export function ApplicationActions({
  applicationId,
  status,
  attended,
  target,
  isAdmin,
  hasSchedulingUrl,
  reapplicationAllowed,
}: {
  applicationId: number;
  status: ApplicationStatus;
  attended: number;
  target: number;
  isAdmin: boolean;
  hasSchedulingUrl: boolean;
  reapplicationAllowed: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const closed = ["approved", "declined", "withdrawn"].includes(status);
  const earlyStage = ["waiting_on_attendance", "ready_to_screen", "invited_to_schedule"].includes(status);
  const suggestion = attended >= target ? "invite" : "attend_more";

  const run = async (action: () => Promise<ApplicationActionResult>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPending(null);
    setReason("");
    router.refresh();
  };

  if (status === "declined") {
    if (reapplicationAllowed) {
      return <p className="text-sm text-muted-foreground">Declined — they&apos;re allowed to apply again.</p>;
    }
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Declined. They can&apos;t apply again, and see nothing suggesting they could, unless you
          allow it.
        </p>
        {isAdmin &&
          (pending === "reapply" ? (
            <Confirm
              text="Let them apply again? The Apply button comes back on their volunteer page. No email is sent — tell them yourself."
              confirmLabel="Allow re-application"
              disabled={busy}
              onConfirm={() => run(() => allowReapplicationAction(applicationId))}
              onCancel={() => setPending(null)}
            />
          ) : (
            <div>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setPending("reapply")}>
                Allow re-application
              </Button>
            </div>
          ))}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    );
  }
  if (closed) return null;

  return (
    <div className="flex flex-col gap-3">
      {earlyStage && (
        <p className="text-sm text-muted-foreground">
          {attended} of {target} events attended —{" "}
          {suggestion === "invite"
            ? "they've met the minimum, so a call is the usual next step."
            : "under the minimum, so we'd usually ask them to come to a few more events first."}{" "}
          Your call either way.
        </p>
      )}

      {earlyStage && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={suggestion === "invite" ? "default" : "outline"}
            disabled={busy}
            onClick={() => setPending("invite")}
          >
            {status === "invited_to_schedule" ? "Re-send call invite" : "Invite to schedule a call"}
          </Button>
          <Button
            type="button"
            variant={suggestion === "attend_more" ? "default" : "outline"}
            disabled={busy}
            onClick={() => setPending("attend_more")}
          >
            Ask them to attend a few events first
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {isAdmin && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => setPending("decline")}>
            Decline
          </Button>
        )}
        {isAdmin && (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setPending("withdraw")}>
            Mark withdrawn
          </Button>
        )}
      </div>

      {pending === "invite" && (
        <Confirm
          text={
            hasSchedulingUrl
              ? "Email them the scheduling link from Setup and move this to Invited to schedule?"
              : "There's no scheduling link in Setup yet — an admin needs to add one before this can be sent."
          }
          confirmLabel="Send the invite"
          disabled={busy || !hasSchedulingUrl}
          onConfirm={() => run(() => sendApplicationEmailAction(applicationId, "invite_to_schedule"))}
          onCancel={() => setPending(null)}
        />
      )}
      {pending === "attend_more" && (
        <Confirm
          text="Send the warm “we'd love to see you at a few more events first — this isn't a no” email, and move this to Waiting on attendance? It comes back to Ready to screen by itself once they've attended two more events (or the minimum, if that's higher)."
          confirmLabel="Send it"
          disabled={busy}
          onConfirm={() => run(() => sendApplicationEmailAction(applicationId, "attend_more"))}
          onCancel={() => setPending(null)}
        />
      )}
      {pending === "decline" && (
        <div className="flex flex-col gap-2 rounded-md border border-red-500/50 bg-red-500/5 p-3">
          <Label htmlFor="decline_reason">Reason (optional, internal — never sent to them)</Label>
          <Textarea id="decline_reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="text-xs text-muted-foreground">No email is sent — you&apos;ll let them know yourself.</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => run(() => declineApplicationAction(applicationId, reason))}
            >
              {busy ? "Declining..." : "Decline application"}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {pending === "withdraw" && (
        <Confirm
          text="Mark this application withdrawn (they asked to stop)? No email is sent."
          confirmLabel="Mark withdrawn"
          disabled={busy}
          onConfirm={() => run(() => withdrawApplicationAction(applicationId))}
          onCancel={() => setPending(null)}
        />
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

function Confirm({
  text,
  confirmLabel,
  disabled,
  onConfirm,
  onCancel,
}: {
  text: string;
  confirmLabel: string;
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <p>{text}</p>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={disabled} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Admin: "events attended before the portal", with the one-line why. */
export function AttendanceCreditEditor({
  userId,
  events,
  note,
}: {
  userId: string;
  events: number;
  note: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(events));
  const [why, setWhy] = useState(note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await setAttendanceCreditAction(userId, Number(value), why);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.refresh();
  };

  if (!open) {
    return (
      <div>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
          {events > 0 ? "Change credit" : "Credit events from before the portal"}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
        <div className="grid gap-1">
          <Label htmlFor="credit_events" className="text-xs">Events</Label>
          <Input id="credit_events" type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="credit_note" className="text-xs">Why (one line)</Label>
          <Input
            id="credit_note"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="e.g. Regular at Denver men's nights since 2023"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={save}>
          {busy ? "Saving..." : "Save"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
