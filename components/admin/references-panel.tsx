"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  markReferencesReviewedAction,
  replaceReferenceAction,
  sendReferenceReminderNowAction,
  sendReferenceRequestsAction,
  type ReferenceActionResult,
} from "@/lib/actions/volunteer-references";
import { REFERENCE_MAX_REMINDERS, referenceSlotLabel } from "@/lib/volunteer-references";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AnswerRow = { label: string; value: string };

/** One live reference request, with dates already formatted (Denver). */
export type ReferencePanelRequest = {
  id: number;
  slot: 1 | 2;
  name: string;
  email: string;
  relationship: string | null;
  matchedVolunteer: boolean;
  requestedOn: string;
  daysWaiting: number;
  remindersSent: number;
  lastReminderOn: string | null;
  manualReminders: number;
  lastManualReminderOn: string | null;
  gaveUpOn: string | null;
  receivedOn: string | null;
  answers: AnswerRow[];
  fishingAnswers: AnswerRow[];
};

export type ReplacedReference = { id: number; slot: 1 | 2; name: string; email: string; requestedOn: string; replacedOn: string };

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/**
 * References on the application review screen: sending, tracking (when each
 * went out, reminders, received or not), the answers once in, replacing a
 * reference who's gone quiet, and an admin's "Mark references reviewed".
 * Answers show to anyone who can see the application.
 */
export function ReferencesPanel({
  applicationId,
  status,
  canSend,
  isAdmin,
  ref1Matched,
  live,
  replaced,
  reviewed,
}: {
  applicationId: number;
  status: string;
  /** can_send_reference_requests — Screened, latest call advanced, not sent. */
  canSend: boolean;
  isAdmin: boolean;
  /** The application's reference 1 is an approved volunteer's email. */
  ref1Matched: boolean;
  live: ReferencePanelRequest[];
  replaced: ReplacedReference[];
  reviewed: { by: string; on: string } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  const run = async (key: string, action: () => Promise<ReferenceActionResult>, success: string) => {
    setBusy(key);
    setMessage(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) {
      setMessage({ text: result.error, tone: "error" });
      return false;
    }
    setMessage(result.warning ? { text: result.warning, tone: "error" } : { text: success, tone: "ok" });
    router.refresh();
    return true;
  };

  const out = status === "references_out";

  return (
    <div className="flex flex-col gap-4 text-sm">
      {canSend && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <p>
            Emails both references a link to a short form (about three minutes, no login) and moves this
            application to References out. Unanswered ones get a weekly reminder, up to three.
          </p>
          {!ref1Matched && (
            <p className="text-amber-700 dark:text-amber-400">
              Reference 1&apos;s email doesn&apos;t match an approved volunteer. Reference 1 should be a current FTGF
              volunteer — check with the applicant before sending, or send and replace them.
            </p>
          )}
          <div>
            <Button
              type="button"
              size="sm"
              disabled={busy != null}
              onClick={() => run("send", () => sendReferenceRequestsAction(applicationId), "Reference requests sent.")}
            >
              {busy === "send" ? "Sending..." : "Send reference requests"}
            </Button>
          </div>
        </div>
      )}

      {!canSend && live.length === 0 && (
        <p className="text-muted-foreground">
          Reference requests can be sent once the latest screening call moves this application forward to references.
        </p>
      )}

      {live.map((r) => (
        <ReferenceCard
          key={r.id}
          request={r}
          canAct={out && !r.receivedOn}
          busy={busy}
          onRemind={() => run(`remind-${r.id}`, () => sendReferenceReminderNowAction(r.id), `Reminder sent to ${r.name}.`)}
          onReplace={(input) => run(`replace-${r.id}`, () => replaceReferenceAction(r.id, input), `Request sent to ${input.name}.`)}
        />
      ))}

      {replaced.length > 0 && (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span className="font-medium">Replaced</span>
          {replaced.map((r) => (
            <span key={r.id}>
              Reference {r.slot}: {r.name} ({r.email}) — asked {r.requestedOn}, replaced {r.replacedOn}
            </span>
          ))}
        </div>
      )}

      {status === "references_in" && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
          {reviewed ? (
            <span>
              References reviewed by {reviewed.by}, {reviewed.on}.
            </span>
          ) : isAdmin ? (
            <>
              <span>Both references are in. Mark them reviewed once you&apos;ve read them — the step before approval.</span>
              <Button
                type="button"
                size="sm"
                disabled={busy != null}
                onClick={() => run("review", () => markReferencesReviewedAction(applicationId), "Marked reviewed.")}
              >
                {busy === "review" ? "Saving..." : "Mark references reviewed"}
              </Button>
            </>
          ) : (
            <span className="text-muted-foreground">Both references are in, waiting on an admin to review them.</span>
          )}
        </div>
      )}

      {message && (
        <p role="status" className={message.tone === "ok" ? "text-green-600" : "text-red-500"}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function ReferenceCard({
  request: r,
  canAct,
  busy,
  onRemind,
  onReplace,
}: {
  request: ReferencePanelRequest;
  canAct: boolean;
  busy: string | null;
  onRemind: () => void;
  onReplace: (input: { name: string; email: string; relationship: string }) => Promise<boolean>;
}) {
  const [replacing, setReplacing] = useState(false);
  const [replacement, setReplacement] = useState({ name: "", email: "", relationship: "" });

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col [overflow-wrap:anywhere]">
          <span className="text-xs font-medium text-muted-foreground">{referenceSlotLabel(r.slot)}</span>
          <span className="font-medium">{r.name}</span>
          <span className="text-muted-foreground">
            {r.email}
            {r.relationship ? ` · ${r.relationship}` : ""}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {r.slot === 1 && !r.matchedVolunteer && <Badge variant="outline">Not matched to a volunteer</Badge>}
          {r.receivedOn ? (
            <Badge className="border-transparent bg-green-600 text-white hover:bg-green-600">Received</Badge>
          ) : r.gaveUpOn ? (
            <Badge variant="destructive">Needs a replacement</Badge>
          ) : (
            <Badge variant="secondary">Waiting</Badge>
          )}
        </div>
      </div>

      <p className="text-muted-foreground">
        Asked {r.requestedOn}
        {r.receivedOn ? ` · received ${r.receivedOn}` : ` · waiting ${days(r.daysWaiting)}`} · automatic reminders{" "}
        {r.remindersSent} of {REFERENCE_MAX_REMINDERS}
        {r.lastReminderOn ? ` (last ${r.lastReminderOn})` : ""}
        {r.manualReminders > 0
          ? ` · ${r.manualReminders} sent by hand${r.lastManualReminderOn ? ` (last ${r.lastManualReminderOn})` : ""}`
          : ""}
      </p>

      {r.gaveUpOn && !r.receivedOn && (
        <p className="rounded-md border border-red-500/50 bg-red-500/10 p-2 text-red-700 dark:text-red-400">
          No answer after {REFERENCE_MAX_REMINDERS} reminders (flagged {r.gaveUpOn}). Ask the applicant for a
          replacement, then use &ldquo;Replace this reference&rdquo;.
        </p>
      )}

      {canAct && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy != null} onClick={onRemind}>
            {busy === `remind-${r.id}` ? "Sending..." : "Send a reminder now"}
          </Button>
          {!replacing && (
            <Button type="button" size="sm" variant="ghost" disabled={busy != null} onClick={() => setReplacing(true)}>
              Replace this reference
            </Button>
          )}
        </div>
      )}
      {canAct && (
        <p className="-mt-1 text-xs text-muted-foreground">
          A reminder sent by hand doesn&apos;t count toward the {REFERENCE_MAX_REMINDERS} automatic ones or change their schedule.
        </p>
      )}

      {canAct && replacing && (
        <form
          className="flex flex-col gap-3 rounded-md bg-muted p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onReplace(replacement)) setReplacing(false);
          }}
        >
          <p className="text-xs text-muted-foreground">
            {r.name}&apos;s link stops working, and the new reference gets their own request and a fresh set of reminders.
            {r.slot === 1 ? " Reference 1 must be a current FTGF volunteer: use the email they sign in to the portal with." : ""}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1">
              <Label htmlFor={`rep_name_${r.id}`} className="text-xs">Name</Label>
              <Input
                id={`rep_name_${r.id}`}
                required
                value={replacement.name}
                onChange={(e) => setReplacement((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`rep_email_${r.id}`} className="text-xs">Email</Label>
              <Input
                id={`rep_email_${r.id}`}
                type="email"
                required
                value={replacement.email}
                onChange={(e) => setReplacement((p) => ({ ...p, email: e.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`rep_rel_${r.id}`} className="text-xs">How they know the applicant (optional)</Label>
              <Input
                id={`rep_rel_${r.id}`}
                value={replacement.relationship}
                onChange={(e) => setReplacement((p) => ({ ...p, relationship: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy != null}>
              {busy === `replace-${r.id}` ? "Sending..." : "Replace and send request"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy != null} onClick={() => setReplacing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {r.receivedOn && (
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          {r.answers.map((a) => (
            <AnswerLine key={a.label} row={a} />
          ))}
        </dl>
      )}
      {r.receivedOn && r.fishingAnswers.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-3">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
            Reference signal, not a practical instruction check. It can inform whether to schedule one and who might run
            it. It doesn&apos;t count as one, however strong.
          </p>
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            {r.fishingAnswers.map((a) => (
              <AnswerLine key={a.label} row={a} />
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function AnswerLine({ row }: { row: AnswerRow }) {
  return (
    <>
      <dt className="text-muted-foreground">{row.label}</dt>
      <dd className="whitespace-pre-line [overflow-wrap:anywhere]">{row.value}</dd>
    </>
  );
}
