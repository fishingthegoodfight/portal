"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { approveApplicationAction, resendRegistrationEmailAction } from "@/lib/actions/volunteer-approval";
import { recordPracticalCheckAction } from "@/lib/actions/practical-checks";
import { allowedForFirstTimer, type ApprovalRoleType } from "@/lib/volunteer-approval";
import { PRACTICAL_CHECK_ROLE_KEYS } from "@/lib/practical-checks";
import { todayInZone } from "@/lib/format-date";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * The approval step (phase 4), admins only, once references are reviewed.
 * Roles start from the screening call's recommendation — a starting point
 * the admin changes freely. A first-time volunteer can only have Fishing
 * Instructor among retreat roles. The practical instruction check sits next
 * to the retreat roles for information: it doesn't block approval (the
 * shift sign-up enforces it). For an instructor the admin knows well, it can
 * be waived here too: the waiver is saved first, then the approval.
 */
export function ApprovalPanel({
  applicationId,
  applicantUserId,
  applicantName,
  roleTypes,
  firstTimer,
  initialSelected,
  prefillNote,
  practicalSummary,
  practicalPassed,
  voucherName,
}: {
  applicationId: number;
  applicantUserId: string;
  applicantName: string;
  /** Active role types, in order. */
  roleTypes: ApprovalRoleType[];
  firstTimer: boolean;
  initialSelected: number[];
  /** Where the starting selection came from, and anything left out. */
  prefillNote: string[];
  practicalSummary: string;
  /** Passed or waived. */
  practicalPassed: boolean;
  /** The admin approving — recorded as who vouches for them on a waiver. */
  voucherName: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number[]>(initialSelected);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waive, setWaive] = useState(false);
  const [waiveReason, setWaiveReason] = useState("");

  const retreatRoles = roleTypes.filter((r) => r.for_retreats);
  const chapterRoles = roleTypes.filter((r) => !r.for_retreats);
  const chosen = roleTypes.filter((r) => selected.includes(r.id));
  const canOfferWaiver = !practicalPassed && chosen.some((r) => PRACTICAL_CHECK_ROLE_KEYS.includes(r.key));
  const waiving = canOfferWaiver && waive;
  const toggle = (id: number, on: boolean) => {
    setConfirming(false);
    setSelected((prev) => (on ? [...prev, id] : prev.filter((v) => v !== id)));
  };

  const approve = async () => {
    if (waiving && !waiveReason.trim()) {
      setError("Say why you're waiving the practical check.");
      return;
    }
    setBusy(true);
    setError(null);
    if (waiving) {
      const waived = await recordPracticalCheckAction(applicantUserId, {
        checkedOn: todayInZone("America/Denver"),
        assessorName: voucherName || "An admin",
        outcome: "waived",
        notes: waiveReason,
      });
      if (!waived.ok) {
        setBusy(false);
        setError(`Nothing was saved: ${waived.error}`);
        return;
      }
    }
    const result = await approveApplicationAction(
      applicationId,
      chosen.map((r) => r.id),
    );
    setBusy(false);
    if (!result.ok) {
      setError(waiving ? `The practical check waiver was saved, but the approval wasn't: ${result.error}` : result.error);
      // Shows the waiver in place of the unchecked practical check.
      if (waiving) router.refresh();
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
        {canOfferWaiver && (
          <div className="flex flex-col gap-2 rounded-md border p-2">
            <label className="flex items-start gap-2">
              <Checkbox
                className="mt-0.5"
                checked={waive}
                disabled={busy}
                onCheckedChange={(c) => {
                  setConfirming(false);
                  setWaive(c === true);
                }}
              />
              <span>
                Waive the practical check — I know their fishing instruction and vouch for it
                <span className="block text-xs text-muted-foreground">
                  Recorded as a waiver by you, dated today, and counted as a pass. A later check replaces it.
                </span>
              </span>
            </label>
            {waive && (
              <div className="grid gap-1">
                <Label htmlFor="waive_reason" className="text-xs">
                  Why (required)
                </Label>
                <Textarea
                  id="waive_reason"
                  value={waiveReason}
                  disabled={busy}
                  onChange={(e) => setWaiveReason(e.target.value)}
                />
              </div>
            )}
          </div>
        )}
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
          {waiving && <p>Practical instruction check: waived by you.</p>}
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
