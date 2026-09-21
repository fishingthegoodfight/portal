"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { confirmRsvpAction, cancelRsvpAction, claimOfferedSpotAction } from "@/lib/actions/rsvp";
import { signWaiverAction } from "@/lib/actions/waiver";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EventCard } from "@/components/event-card";
import { RegistrationSectionField } from "@/components/registration-section-field";
import {
  EMPTY_WAIVER_SIGN,
  WaiverSigning,
  waiverNeedsInput,
  type WaiverSignState,
} from "@/components/waiver-signing";
import type { WaiverInfo } from "@/lib/waivers";
import {
  collectSectionUpdates,
  columnValuesFromProfile,
  DIETARY_NONE,
  firstIncompleteSection,
  sectionsForEvent,
} from "@/lib/registration-sections";

type EventSummary = {
  id: number;
  name: string;
  chapter: string | null;
  event_type: string | null;
  // Formatted server-side (see the rsvp page loader) rather than formatted
  // here with Intl — this is a client component, so formatting it at render
  // time would run again during client hydration and mismatch the SSR output
  // whenever the server and browser sit in different timezones.
  dateRange: string;
  location: string | null;
  description: string | null;
  capacity: number | null;
  spots_taken: number | null;
  registration_sections: string[];
};

type ProfileSummary = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
};

type InitialRsvp = {
  status: string;
  dietaryNotes: string;
} | null;

function extractErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message: unknown }).message);
    const hint =
      "hint" in error ? (error as { hint?: string }).hint : undefined;
    return hint ? `${message} (${hint})` : message;
  }
  return "An error occurred";
}

export function RsvpForm({
  userId,
  event,
  profile,
  profileFields,
  initialRsvp,
  waitlistPosition,
  offerExpiresLabel,
  offerLapsed,
  waiver,
}: {
  userId: string;
  event: EventSummary;
  profile: ProfileSummary;
  /** Every registration field's current profile value, keyed by column. */
  profileFields: Record<string, string>;
  initialRsvp: InitialRsvp;
  /** 1-based place in line when waitlisted, else null. */
  waitlistPosition: number | null;
  /** When an open offer expires, formatted in the event's timezone — done
   * server-side for the same hydration reason as `dateRange`. */
  offerExpiresLabel: string | null;
  /** The caller had an offer that ran out unclaimed. */
  offerLapsed: boolean;
  /** Where this person stands on the event's waiver (every event has one). */
  waiver: WaiverInfo;
}) {
  const router = useRouter();
  // Seeded from the profile so a partially-complete section (e.g. a name but
  // no phone) doesn't make the user retype what's already on file.
  const [fieldValues, setFieldValues] =
    useState<Record<string, string>>(profileFields);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [waiverSign, setWaiverSign] = useState<WaiverSignState>(EMPTY_WAIVER_SIGN);
  const [error, setError] = useState<string | null>(null);

  const activeSections = sectionsForEvent(event.registration_sections);

  const status = initialRsvp?.status ?? null;
  const hasActiveRsvp = Boolean(status) && status !== "cancelled";
  const isOffered = status === "offered";
  const isWaitlisted = status === "waitlisted";
  const spotsLeft =
    event.capacity != null && event.spots_taken != null
      ? event.capacity - event.spots_taken
      : null;
  // Spots-left is as of page load — the capacity-check function is the real
  // gate at submit time; this just avoids inviting a doomed submission.
  const isFull = spotsLeft != null && spotsLeft <= 0 && !hasActiveRsvp;
  const profileIncomplete =
    !profile.first_name || !profile.last_name || !profile.email;

  const updateField = (key: string, value: string) =>
    setFieldValues((prev) => ({ ...prev, [key]: value }));

  const incompleteRequiredSection = firstIncompleteSection(activeSections, fieldValues);
  const waiverBlocked = waiverNeedsInput(waiver, waiverSign);
  const hasMissingRequired = Boolean(incompleteRequiredSection) || waiverBlocked;

  const editProfileHref = `/protected/profile?return_to=${encodeURIComponent(
    `/protected/events/${event.id}/rsvp`,
  )}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // A confirmed/waitlisted/offered RSVP shows no submit button — this only fires if
    // the form is submitted another way (e.g. Enter). Cancel is the only
    // action available from that state.
    if (hasActiveRsvp) return;
    setError(null);
    if (incompleteRequiredSection) {
      // Belt-and-suspenders: the submit button is disabled for this case
      // too, but guard here in case the form is ever submitted some other
      // way (e.g. pressing Enter before React re-renders the disabled state).
      setError(
        `Complete "${incompleteRequiredSection.title}" before RSVPing.`,
      );
      return;
    }
    setIsSubmitting(true);
    const supabase = createClient();

    try {
      // Save any newly-entered values to the profile so these sections are
      // never asked again on a future RSVP. Sections already complete are
      // left untouched.
      const profileUpdates = collectSectionUpdates(activeSections, profileFields, fieldValues);
      if (Object.keys(profileUpdates).length > 0) {
        const { error: profileError } = await supabase
          .from("profiles")
          .update(columnValuesFromProfile(profileUpdates))
          .eq("id", userId);
        if (profileError) throw profileError;
      }

      const effectiveValues = { ...fieldValues, ...profileUpdates };
      const dietaryActive = activeSections.some((s) => s.id === "dietary");
      // The rsvp row's dietary_notes is free text for organizers — an explicit
      // "No" (the DIETARY_NONE sentinel we keep on the profile) is just absence
      // of notes here.
      const dietaryNotes = effectiveValues.dietary_notes;

      // Sign the waiver first (it's stored against the exact waiver row the
      // server resolves for this event); confirmRsvpAction re-checks it.
      if (waiver.status === "unsigned") {
        const signed = await signWaiverAction(event.id, waiverSign.name, waiverSign.agreed);
        if (!signed.ok) throw new Error(signed.error);
      }

      const result = await confirmRsvpAction(
        event.id,
        dietaryActive && dietaryNotes && dietaryNotes !== DIETARY_NONE
          ? dietaryNotes
          : null,
      );
      if (!result.ok) throw new Error(result.error);

      const rsvpStatus = result.status === "waitlisted" ? "waitlisted" : "confirmed";
      const params = new URLSearchParams({
        rsvp: rsvpStatus === "waitlisted" ? "waitlisted" : "confirmed",
        event: event.name,
      });
      router.push(`/protected/events?${params.toString()}`);
    } catch (err: unknown) {
      console.error("RSVP failed:", err);
      setError(extractErrorMessage(err));
    } finally {
      // Clear pending on every path, success included — otherwise a bfcache
      // restore of this page (browser back after the redirect) shows a stuck,
      // disabled "Submitting...".
      setIsSubmitting(false);
    }
  };

  // Someone already registered who still owes a signature — e.g. the event
  // moved to a chapter in the other state, which switches its waiver. They
  // have no submit button (their RSVP stands), so signing has its own action.
  const needsWaiverSignature = hasActiveRsvp && waiver.status === "unsigned";

  const handleSignWaiver = async () => {
    setIsSigning(true);
    setError(null);
    try {
      const result = await signWaiverAction(event.id, waiverSign.name, waiverSign.agreed);
      if (!result.ok) throw new Error(result.error);
      setWaiverSign(EMPTY_WAIVER_SIGN);
      router.refresh();
    } catch (err: unknown) {
      console.error("Sign waiver failed:", err);
      setError(extractErrorMessage(err));
    } finally {
      setIsSigning(false);
    }
  };

  const handleClaim = async () => {
    setIsClaiming(true);
    setError(null);

    try {
      const result = await claimOfferedSpotAction(event.id);
      if (!result.ok) {
        // Offer expired / spot gone: show why, and refresh so the page
        // reflects the real state instead of a stale Claim button.
        setError(result.error);
        router.refresh();
        return;
      }
      const params = new URLSearchParams({ rsvp: "confirmed", event: event.name });
      router.push(`/protected/events?${params.toString()}`);
    } catch (err: unknown) {
      console.error("Claim spot failed:", err);
      setError(extractErrorMessage(err));
    } finally {
      setIsClaiming(false);
    }
  };

  const handleCancel = async () => {
    setIsCancelling(true);
    setError(null);

    try {
      const result = await cancelRsvpAction(event.id);
      if (!result.ok) throw new Error(result.error);

      const params = new URLSearchParams({
        rsvp: "cancelled",
        event: event.name,
      });
      router.push(`/protected/events?${params.toString()}`);
    } catch (err: unknown) {
      console.error("Cancel RSVP failed:", err);
      setError(extractErrorMessage(err));
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <EventCard event={event} rsvpStatus={status} />

      <Card>
        <CardHeader>
          <CardTitle>Your RSVP</CardTitle>
          <CardDescription>
            RSVPing as {profile.first_name || "?"} {profile.last_name}
            {profile.email ? ` · ${profile.email}` : ""}
            {profile.phone ? ` · ${profile.phone}` : ""}.{" "}
            <Link
              href={editProfileHref}
              className="underline underline-offset-4"
            >
              Edit profile
            </Link>
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="flex flex-col gap-4">
            {profileIncomplete && (
              <p className="text-sm text-amber-600">
                Your profile is missing your name or email — you can still
                RSVP, but consider completing it first.
              </p>
            )}
            {needsWaiverSignature && waiver.status === "unsigned" && (
              <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                <span className="font-medium">Action needed:</span> please read and sign the{" "}
                {waiver.heading} below before the event. Your spot is still yours.
              </p>
            )}
            {activeSections.map((section) =>
              section.kind === "waiver" ? (
                <div key={section.id} className="grid gap-1 rounded-md border p-3">
                  <span className="text-sm font-medium">{section.title}</span>
                  <WaiverSigning
                    info={waiver}
                    value={waiverSign}
                    onChange={setWaiverSign}
                    idPrefix="rsvp"
                  />
                </div>
              ) : (
                <RegistrationSectionField
                  key={section.id}
                  section={section}
                  profileFields={profileFields}
                  fieldValues={fieldValues}
                  onChange={updateField}
                  editProfileHref={editProfileHref}
                />
              ),
            )}
            {isOffered && (
              <p className="rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm">
                <span className="font-medium">A spot opened up for you!</span> It&apos;s held
                {offerExpiresLabel ? ` until ${offerExpiresLabel}` : " for 24 hours"}. Claim it
                below, or decline so the next person can have it.
              </p>
            )}
            {isWaitlisted && (
              <p className="text-sm">
                <span className="font-medium">
                  You&apos;re #{waitlistPosition ?? "?"} on the waitlist.
                </span>{" "}
                We&apos;ll email you if a spot opens up.
              </p>
            )}
            {status === "confirmed" && (
              <p className="text-sm">
                Current status: <span className="font-medium">confirmed</span>
              </p>
            )}
            {offerLapsed && !hasActiveRsvp && (
              <p className="text-sm text-amber-600">
                Your earlier spot offer expired before it was claimed.
                {isFull
                  ? " You can join the waitlist again — you'll go to the back of the line."
                  : " You can RSVP again below."}
              </p>
            )}
            {isFull && !offerLapsed && (
              <p className="text-sm text-amber-600">
                This event is full. You can join the waitlist and we&apos;ll email you if a
                spot opens up.
              </p>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
          </CardContent>
          <CardFooter className="flex gap-2">
            {hasActiveRsvp ? (
              <>
                {needsWaiverSignature && (
                  <Button
                    type="button"
                    onClick={handleSignWaiver}
                    disabled={isSigning || waiverNeedsInput(waiver, waiverSign)}
                  >
                    {isSigning ? "Signing..." : "Sign waiver"}
                  </Button>
                )}
                {isOffered && (
                  <Button
                    type="button"
                    onClick={handleClaim}
                    disabled={isClaiming || isCancelling}
                  >
                    {isClaiming ? "Claiming..." : "Claim your spot"}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isCancelling || isClaiming}
                >
                  {isCancelling
                    ? isOffered
                      ? "Declining..."
                      : isWaitlisted
                        ? "Leaving..."
                        : "Cancelling..."
                    : isOffered
                      ? "Decline offer"
                      : isWaitlisted
                        ? "Leave waitlist"
                        : "Cancel RSVP"}
                </Button>
              </>
            ) : (
              <Button
                type="submit"
                disabled={isSubmitting || hasMissingRequired}
              >
                {isSubmitting
                  ? isFull
                    ? "Joining..."
                    : "Submitting..."
                  : isFull
                    ? "Join waitlist"
                    : "RSVP"}
              </Button>
            )}
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
