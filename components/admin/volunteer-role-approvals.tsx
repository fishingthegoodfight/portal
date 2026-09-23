"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { approveRoleAction, revokeRoleAction } from "@/lib/actions/volunteer-admin";
import { VOLUNTEER_STATUS_LABELS, type VolunteerStatus } from "@/lib/volunteers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RevealPanel } from "@/components/reveal-panel";

export type RoleTypeForApproval = {
  id: number;
  name: string;
  requires_cert: boolean;
  /** Set (the active approval's id) when currently approved; null otherwise. */
  activeApprovalId: number | null;
};

/** Approve/revoke controls for every role type, against one volunteer.
 * Revoking never deletes the row (see the schema note on
 * volunteer_role_approvals) — it's recorded via revoked_by/revoked_at.
 *
 * A role approval does nothing on its own until the volunteer's status is
 * 'approved' too, so approving a role for someone who isn't asks first and
 * offers to set their status in the same click. That question, errors, and
 * the "approved, but not an approved volunteer" follow-up all appear right
 * under the role's own row (and scroll into view), not at the end of the
 * list — see RevealPanel. */
export function VolunteerRoleApprovals({
  volunteerId,
  volunteerName,
  volunteerStatus,
  roleTypes,
  hasCurrentCert,
}: {
  volunteerId: string;
  volunteerName: string;
  volunteerStatus: VolunteerStatus;
  roleTypes: RoleTypeForApproval[];
  /** Whether a current (unexpired) First Aid/CPR/AED cert is on file — used
   * to flag "cert required, not on file" on a requires_cert role. */
  hasCurrentCert: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<number | null>(null);
  // An error, shown under the row (role type id) whose button caused it.
  const [error, setError] = useState<{ roleTypeId: number; text: string } | null>(null);
  // A role approved "on its own" for someone who isn't an approved volunteer:
  // the follow-up note under that row (the page's own banner is at the top).
  const [approvedOnlyFor, setApprovedOnlyFor] = useState<number | null>(null);
  const [certWarningFor, setCertWarningFor] = useState<number | null>(null);
  // The role type waiting on the "not an approved volunteer yet" question.
  const [askingFor, setAskingFor] = useState<number | null>(null);

  const approve = async (roleTypeId: number, setApproved: boolean) => {
    setAskingFor(null);
    setPendingId(roleTypeId);
    setError(null);
    setApprovedOnlyFor(null);
    const result = await approveRoleAction(volunteerId, roleTypeId, setApproved);
    setPendingId(null);
    if (!result.ok) {
      setError({ roleTypeId, text: result.error });
      return;
    }
    if (result.certWarning) setCertWarningFor(roleTypeId);
    if (!setApproved && volunteerStatus !== "approved") setApprovedOnlyFor(roleTypeId);
    router.refresh();
  };

  const revoke = async (roleTypeId: number, approvalId: number) => {
    setPendingId(approvalId);
    setError(null);
    setApprovedOnlyFor(null);
    const result = await revokeRoleAction(approvalId);
    setPendingId(null);
    if (!result.ok) {
      setError({ roleTypeId, text: result.error });
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      {roleTypes.map((rt) => {
        const approved = rt.activeApprovalId != null;
        const flagCert = rt.requires_cert && (approved ? !hasCurrentCert : certWarningFor === rt.id);
        const asking = askingFor === rt.id;
        return (
          <div key={rt.id} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{rt.name}</span>
                {approved && <Badge variant="secondary">Approved</Badge>}
                {flagCert && <Badge variant="destructive">Cert required, not on file</Badge>}
              </div>
              {approved ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pendingId === rt.activeApprovalId}
                  onClick={() => revoke(rt.id, rt.activeApprovalId as number)}
                >
                  {pendingId === rt.activeApprovalId ? "Revoking..." : "Revoke"}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pendingId === rt.id || asking}
                  onClick={() => {
                    setError(null);
                    setApprovedOnlyFor(null);
                    if (volunteerStatus === "approved") void approve(rt.id, false);
                    else setAskingFor(rt.id);
                  }}
                >
                  {pendingId === rt.id ? "Approving..." : asking ? "Confirm below" : "Approve"}
                </Button>
              )}
            </div>
            {asking && (
              <RevealPanel
                aria-label={`Approve ${rt.name}`}
                className="flex flex-col gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
              >
                <p className="text-amber-700 dark:text-amber-400">
                  <strong>{volunteerName}</strong> isn&apos;t an approved volunteer yet (status:{" "}
                  {VOLUNTEER_STATUS_LABELS[volunteerStatus] ?? volunteerStatus}). Approving{" "}
                  <strong>{rt.name}</strong> on its own won&apos;t let them sign up for anything —
                  they also need to be an approved volunteer.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => approve(rt.id, true)}>
                    Approve role and set status to Approved
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => approve(rt.id, false)}>
                    Approve role only
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAskingFor(null)}>
                    Cancel
                  </Button>
                </div>
              </RevealPanel>
            )}
            {approvedOnlyFor === rt.id && approved && (
              <RevealPanel
                role="alert"
                className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
              >
                {rt.name} approved — but {volunteerName} still isn&apos;t an approved volunteer, so
                they can&apos;t sign up for it yet. Change their status to Approved with the status
                menu at the top of the page when they&apos;re ready.
              </RevealPanel>
            )}
            {error?.roleTypeId === rt.id && (
              <RevealPanel role="alert" className="text-sm text-red-500">
                {error.text}
              </RevealPanel>
            )}
          </div>
        );
      })}
    </div>
  );
}
