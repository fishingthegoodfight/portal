"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { approveRoleAction, revokeRoleAction } from "@/lib/actions/volunteer-admin";
import { VOLUNTEER_STATUS_LABELS, type VolunteerStatus } from "@/lib/volunteers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
 * offers to set their status in the same click. */
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
  const [error, setError] = useState<string | null>(null);
  const [certWarningFor, setCertWarningFor] = useState<number | null>(null);
  // The role type waiting on the "not an approved volunteer yet" question.
  const [askingFor, setAskingFor] = useState<number | null>(null);

  const approve = async (roleTypeId: number, setApproved: boolean) => {
    setAskingFor(null);
    setPendingId(roleTypeId);
    setError(null);
    const result = await approveRoleAction(volunteerId, roleTypeId, setApproved);
    setPendingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.certWarning) setCertWarningFor(roleTypeId);
    router.refresh();
  };

  const revoke = async (approvalId: number) => {
    setPendingId(approvalId);
    setError(null);
    const result = await revokeRoleAction(approvalId);
    setPendingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-red-500">{error}</p>}
      {roleTypes.map((rt) => {
        const approved = rt.activeApprovalId != null;
        const flagCert = rt.requires_cert && (approved ? !hasCurrentCert : certWarningFor === rt.id);
        return (
          <div key={rt.id} className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
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
                onClick={() => revoke(rt.activeApprovalId as number)}
              >
                Revoke
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendingId === rt.id || askingFor === rt.id}
                onClick={() =>
                  volunteerStatus === "approved" ? approve(rt.id, false) : setAskingFor(rt.id)
                }
              >
                Approve
              </Button>
            )}
          </div>
        );
      })}
      {askingFor != null && (
        <div
          role="alertdialog"
          className="flex flex-col gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
        >
          <p className="text-amber-700 dark:text-amber-400">
            <strong>{volunteerName}</strong> isn&apos;t an approved volunteer yet (status:{" "}
            {VOLUNTEER_STATUS_LABELS[volunteerStatus] ?? volunteerStatus}). Approving{" "}
            <strong>{roleTypes.find((rt) => rt.id === askingFor)?.name}</strong> on its own
            won&apos;t let them sign up for anything — they also need to be an approved volunteer.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => approve(askingFor, true)}>
              Approve role and set status to Approved
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => approve(askingFor, false)}
            >
              Approve role only
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAskingFor(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
