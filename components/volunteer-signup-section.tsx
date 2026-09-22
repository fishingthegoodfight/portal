"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  cancelVolunteerSignupAction,
  signUpForVolunteerShiftAction,
} from "@/lib/actions/volunteer-signup";
import { signVolunteerWaiverForEventAction } from "@/lib/actions/waiver";
import {
  EMPTY_WAIVER_SIGN,
  WaiverSigning,
  waiverNeedsInput,
  type WaiverSignState,
} from "@/components/waiver-signing";
import type { WaiverInfo } from "@/lib/waivers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type EligibleVolunteerRole = {
  id: number;
  role: string;
  description: string | null;
  whatToBring: string | null;
  /** Pre-formatted in the event's own timezone — see lib/format-date.ts. */
  shiftDateRange: string;
  spotsRemaining: number;
  /** This viewer already has a confirmed signup for it. */
  signedUp: boolean;
};

export function VolunteerSignupSection({
  eventId,
  isApprovedVolunteer,
  eligibleRoles,
  waiver,
}: {
  eventId: number;
  isApprovedVolunteer: boolean;
  /** Roles at this event the caller is role-eligible for — already filtered
   * server-side (see lib/volunteer-signups.ts#eligibleOpportunities). */
  eligibleRoles: EligibleVolunteerRole[];
  /** The volunteer-audience waiver for this event, not the participant one —
   * see waiverInfoForVolunteerAtEvent. */
  waiver: WaiverInfo;
}) {
  const router = useRouter();
  const [waiverSign, setWaiverSign] = useState<WaiverSignState>(EMPTY_WAIVER_SIGN);
  const [isSigning, setIsSigning] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isApprovedVolunteer) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Volunteer</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Volunteering at this event requires an approved volunteer registration. Contact{" "}
            <a href="mailto:tcramer@fishingthegoodfight.org" className="underline underline-offset-4">
              tcramer@fishingthegoodfight.org
            </a>{" "}
            to get started.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (eligibleRoles.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Volunteer</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            You&apos;re not approved for any of the volunteer roles at this event yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  const waiverSigned = waiver.status === "signed";

  const handleSignWaiver = async () => {
    setIsSigning(true);
    setError(null);
    try {
      const result = await signVolunteerWaiverForEventAction(
        eventId,
        waiverSign.name,
        waiverSign.agreed,
      );
      if (!result.ok) throw new Error(result.error);
      setWaiverSign(EMPTY_WAIVER_SIGN);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setIsSigning(false);
    }
  };

  const handleSignUp = async (opportunityId: number) => {
    setBusyId(opportunityId);
    setError(null);
    try {
      const result = await signUpForVolunteerShiftAction(opportunityId);
      if (!result.ok) throw new Error(result.error);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (opportunityId: number) => {
    setBusyId(opportunityId);
    setError(null);
    try {
      const result = await cancelVolunteerSignupAction(opportunityId);
      if (!result.ok) throw new Error(result.error);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Volunteer</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!waiverSigned && (
          <div className="grid gap-1 rounded-md border p-3">
            <span className="text-sm font-medium">Volunteer liability waiver</span>
            <WaiverSigning
              info={waiver}
              value={waiverSign}
              onChange={setWaiverSign}
              idPrefix="volunteer-shift"
            />
            {waiver.status === "unsigned" && (
              <Button
                type="button"
                className="mt-2 w-fit"
                disabled={isSigning || waiverNeedsInput(waiver, waiverSign)}
                onClick={handleSignWaiver}
              >
                {isSigning ? "Signing..." : "Sign waiver"}
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {eligibleRoles.map((role) => {
            const isFull = role.spotsRemaining <= 0 && !role.signedUp;
            return (
              <div key={role.id} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{role.role}</span>
                    <span className="text-sm text-muted-foreground">{role.shiftDateRange}</span>
                  </div>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {role.signedUp
                      ? "You're signed up"
                      : isFull
                        ? "Full"
                        : `${role.spotsRemaining} spot${role.spotsRemaining === 1 ? "" : "s"} left`}
                  </span>
                </div>
                {role.description && <p className="text-sm text-muted-foreground">{role.description}</p>}
                {role.whatToBring && (
                  <p className="text-sm text-muted-foreground">
                    <strong>Bring:</strong> {role.whatToBring}
                  </p>
                )}
                <div>
                  {role.signedUp ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyId === role.id}
                      onClick={() => handleCancel(role.id)}
                    >
                      {busyId === role.id ? "Cancelling..." : "Cancel"}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busyId === role.id || isFull || !waiverSigned}
                      onClick={() => handleSignUp(role.id)}
                    >
                      {busyId === role.id ? "Signing up..." : isFull ? "Full" : "Sign up"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
      </CardContent>
    </Card>
  );
}
