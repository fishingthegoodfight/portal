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
import { RegistrationSectionField } from "@/components/registration-section-field";
import { RevealPanel } from "@/components/reveal-panel";
import {
  firstIncompleteSection,
  isSectionComplete,
  sectionsForEvent,
} from "@/lib/registration-sections";

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

const RSVP_STATUS_PHRASES: Record<string, string> = {
  confirmed: "You're registered to attend this event",
  waitlisted: "You're on the waitlist to attend this event",
  offered: "You've been offered a spot to attend this event",
};

export function VolunteerSignupSection({
  eventId,
  isApprovedVolunteer,
  eligibleRoles,
  waiver,
  registrationSectionIds,
  profileFields,
  rsvpStatus,
  editProfileHref,
}: {
  eventId: number;
  isApprovedVolunteer: boolean;
  /** Roles at this event the caller is role-eligible for — already filtered
   * server-side (see lib/volunteer-signups.ts#eligibleOpportunities). */
  eligibleRoles: EligibleVolunteerRole[];
  /** The volunteer-audience waiver for this event, not the participant one —
   * see waiverInfoForVolunteerAtEvent. */
  waiver: WaiverInfo;
  /** The event's registration_sections — volunteers answer the same ones
   * participants do (dietary, sizing, …), with the same on-file behavior. */
  registrationSectionIds: string[];
  /** Every registration field's current profile value, keyed by column. */
  profileFields: Record<string, string>;
  /** The caller's ACTIVE RSVP status here, if any — signing up is then a
   * "Switch to volunteering" (attend or volunteer, never both). */
  rsvpStatus: string | null;
  editProfileHref: string;
}) {
  const router = useRouter();
  const [waiverSign, setWaiverSign] = useState<WaiverSignState>(EMPTY_WAIVER_SIGN);
  const [isSigning, setIsSigning] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  // Shown under the role whose button caused it, or (roleId null — the
  // waiver step) under the waiver block.
  const [error, setErrorState] = useState<{ roleId: number | null; text: string } | null>(null);
  const setError = (text: string | null, roleId: number | null = null) =>
    setErrorState(text ? { roleId, text } : null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(profileFields);
  // The role whose sign-up step is open: the registration sections still to
  // answer and/or the "Switch to volunteering" confirmation. `switchFrom` is
  // the RSVP status being given up (from the page, or from the server if the
  // page was stale).
  const [pending, setPending] = useState<{ roleId: number; switchFrom: string | null } | null>(null);

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
  // The waiver section is the participant one — volunteers sign their own
  // above — so it's left out; everything else is collected like an RSVP.
  const activeSections = sectionsForEvent(registrationSectionIds).filter(
    (section) => section.kind !== "waiver",
  );
  const needsAnswers = activeSections.some(
    (section) => section.alwaysEditable || !isSectionComplete(section, profileFields),
  );
  const incompleteSection = firstIncompleteSection(activeSections, fieldValues);

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

  // "Sign up" goes straight through when there's nothing to answer or
  // confirm; otherwise it opens that role's sign-up step first.
  const startSignUp = (opportunityId: number) => {
    setError(null);
    if (!needsAnswers && !rsvpStatus) {
      void submitSignUp(opportunityId, null);
      return;
    }
    setPending({ roleId: opportunityId, switchFrom: rsvpStatus });
  };

  const submitSignUp = async (opportunityId: number, switchFrom: string | null) => {
    if (incompleteSection) {
      setError(`Complete "${incompleteSection.title}" first.`, opportunityId);
      return;
    }
    setBusyId(opportunityId);
    setError(null);
    try {
      const result = await signUpForVolunteerShiftAction(opportunityId, {
        sections: fieldValues,
        switchFromRsvp: Boolean(switchFrom),
      });
      if (!result.ok) {
        if ("needsSwitch" in result) {
          // Registered to attend since the page loaded — confirm the switch.
          setPending({ roleId: opportunityId, switchFrom: result.rsvpStatus });
          return;
        }
        throw new Error(result.error);
      }
      setPending(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.", opportunityId);
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
      setError(err instanceof Error ? err.message : "Something went wrong — try again.", opportunityId);
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
            {error?.roleId === null && (
              <RevealPanel role="alert" revealKey={error.text} className="text-sm text-red-500">
                {error.text}
              </RevealPanel>
            )}
          </div>
        )}

        {rsvpStatus && (
          <p className="text-sm text-muted-foreground">
            {RSVP_STATUS_PHRASES[rsvpStatus] ?? "You're registered to attend this event"}. You
            can attend or volunteer, not both — signing up for a shift switches you to
            volunteering.
          </p>
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
                  ) : pending?.roleId !== role.id ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busyId != null || isFull || !waiverSigned}
                      onClick={() => startSignUp(role.id)}
                    >
                      {busyId === role.id
                        ? "Signing up..."
                        : isFull
                          ? "Full"
                          : rsvpStatus
                            ? "Switch to volunteering"
                            : "Sign up"}
                    </Button>
                  ) : null}
                </div>
                {pending?.roleId === role.id && !role.signedUp && (
                  <RevealPanel
                    aria-label={pending.switchFrom ? "Switch to volunteering?" : `Sign up as ${role.role}`}
                    className="flex flex-col gap-3 border-t pt-3"
                  >
                    {activeSections.map((section) => (
                      <RegistrationSectionField
                        key={section.id}
                        section={section}
                        profileFields={profileFields}
                        fieldValues={fieldValues}
                        onChange={(key, value) =>
                          setFieldValues((prev) => ({ ...prev, [key]: value }))
                        }
                        editProfileHref={editProfileHref}
                        requiredNote="Required to volunteer — none on file yet."
                      />
                    ))}
                    {pending.switchFrom && (
                      <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                        <span className="font-medium">Switch to volunteering?</span>{" "}
                        {pending.switchFrom === "confirmed"
                          ? "Your RSVP to attend will be cancelled and your spot offered to the next person on the waitlist."
                          : pending.switchFrom === "offered"
                            ? "The spot you've been offered will go to the next person on the waitlist."
                            : "You'll be taken off the waitlist to attend."}{" "}
                        You&apos;ll be signed up as {role.role} instead, and we&apos;ll email you
                        the details.
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busyId != null || Boolean(incompleteSection)}
                        onClick={() => submitSignUp(role.id, pending.switchFrom)}
                      >
                        {busyId === role.id
                          ? pending.switchFrom
                            ? "Switching..."
                            : "Signing up..."
                          : pending.switchFrom
                            ? "Switch to volunteering"
                            : "Confirm sign up"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busyId != null}
                        onClick={() => {
                          setPending(null);
                          setError(null);
                        }}
                      >
                        {pending.switchFrom ? "Keep my RSVP" : "Back"}
                      </Button>
                    </div>
                  </RevealPanel>
                )}
                {error?.roleId === role.id && (
                  <RevealPanel role="alert" revealKey={error.text} className="text-sm text-red-500">
                    {error.text}
                  </RevealPanel>
                )}
              </div>
            );
          })}
        </div>


      </CardContent>
    </Card>
  );
}
