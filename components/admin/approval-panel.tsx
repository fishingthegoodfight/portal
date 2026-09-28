"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { approveApplicationAction, resendRegistrationEmailAction } from "@/lib/actions/volunteer-approval";
import { allowedForFirstTimer, type ApprovalRoleType } from "@/lib/volunteer-approval";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * The approval step (phase 4), admins only, once references are reviewed.
 * Roles start from the screening call's recommendation — a starting point
 * the admin changes freely. A first-time volunteer can only have Fishing
 * Instructor among retreat roles. The practical instruction check sits next
 * to the retreat roles for information: it doesn't block approval (the
 * shift sign-up enforces it).
 */
export function ApprovalPanel({
  applicationId,
  applicantName,
  roleTypes,
  firstTimer,
  initialSelected,
  prefillNote,
  practicalSummary,
  practicalPassed,
}: {
  applicationId: number;
  applicantName: string;
  /** Active role types, in order. */
  roleTypes: ApprovalRoleType[];
  firstTimer: boolean;
  initialSelected: number[];
  /** Where the starting selection came from, and anything left out. */
  prefillNote: string[];
  practicalSummary: string;
  practicalPassed: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number[]>(initialSelected);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retreatRoles = roleTypes.filter((r) => r.for_retreats);
  const chapterRoles = roleTypes.filter((r) => !r.for_retreats);
  const chosen = roleTypes.filter((r) => selected.includes(r.id));
  const toggle = (id: number, on: boolean) => {
    setConfirming(false);
    setSelected((prev) => (on ? [...prev, id] : prev.filter((v) => v !== id)));
  };

  const approve = async () => {
    setBusy(true);
    setError(null);
    const result = await approveApplicationAction(
      applicationId,
      chosen.map((r) => r.id),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Approved either way; a failed email shows on the approved panel with
    // a resend.
    router.refresh();
  };

  const roleRow = (role: ApprovalRoleType) => {
    const blocked = firstTimer && !allowedForFirstTimer(role);
    return (
      <label key={role.id} className={`flex items-start gap-2 ${blocked ? "text-muted-foreground" : ""}`}>
        <Checkbox
          className="mt-0.5"
          checked={selected.includes(role.id)}
          disabled={blocked || busy}
          onCheckedChange={(c) => toggle(role.id, c === true)}
        />
        <span>
          {role.name}
          {role.for_retreats && role.for_chapter_events && (
            <span className="text-muted-foreground"> · retreats and chapter events</span>
          )}
          {blocked && (
            <span className="block text-xs">
              Not for first-time volunteers. Add it later from their volunteer record.
            </span>
          )}
        </span>
      </label>
    );
  };

  return (
    <div className="flex flex-col gap-4 text-sm">
      {prefillNote.map((line) => (
        <p key={line} className="text-muted-foreground">
          {line}
        </p>
      ))}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">Retreat roles</legend>
        <p
          className={`rounded-md border p-2 text-xs ${
            practicalPassed ? "" : "border-amber-500/50 bg-amber-500/10"
          }`}
        >
          <span className="font-medium">Practical instruction check:</span> {practicalSummary}. Needed before
          they work a retreat as an instructor. It doesn&apos;t hold up approval: shift sign-up checks it.
        </p>
        {retreatRoles.map(roleRow)}
      </fieldset>

      {chapterRoles.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium">Chapter event roles</legend>
          {chapterRoles.map(roleRow)}
        </fieldset>
      )}

      {!confirming ? (
        <div>
          <Button type="button" disabled={chosen.length === 0 || busy} onClick={() => setConfirming(true)}>
            Approve…
          </Button>
          {chosen.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Choose at least one role.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-green-700/50 bg-green-700/5 p-3">
          <p>
            Approve <span className="font-semibold">{applicantName}</span> as a volunteer for:
          </p>
          <ul className="list-disc pl-5">
            {chosen.map((r) => (
              <li key={r.id}>{r.name}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            This makes them an Approved volunteer with these roles, recorded as approved by you today,
            closes this application as Approved, and emails them the volunteer registration form.
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={approve}>
              {busy ? "Approving..." : `Approve ${applicantName}`}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}

/** "Resend registration email" on an approved application. */
export function ResendRegistrationEmailButton({ applicationId, label }: { applicationId: number; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMessage(null);
            const result = await resendRegistrationEmailAction(applicationId);
            setBusy(false);
            setMessage(result.ok ? { ok: true, text: "Sent." } : { ok: false, text: result.error });
            if (result.ok) router.refresh();
          }}
        >
          {busy ? "Sending..." : label}
        </Button>
      </div>
      {message && <p className={`text-xs ${message.ok ? "text-muted-foreground" : "text-red-500"}`}>{message.text}</p>}
    </div>
  );
}
