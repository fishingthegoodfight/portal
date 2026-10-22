"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { addWalkupRsvpAction } from "@/lib/actions/admin-walkup";
import { walkupLookupAction } from "@/lib/actions/waiver";
import { RegistrationSectionField } from "@/components/registration-section-field";
import { EMPTY_WAIVER_SIGN, WaiverSigning, waiverNeedsInput, type WaiverSignState } from "@/components/waiver-signing";
import type { WaiverInfo } from "@/lib/waivers";
import { EmergencyContactFields } from "@/components/emergency-contact-fields";
import { EventPersonResults } from "@/components/admin/event-person-search";
import type { EventPersonCandidate } from "@/lib/actions/event-people";
import { isEmailAddress } from "@/lib/profile-email";
import { Button } from "@/components/ui/button";
import { RevealPanel } from "@/components/reveal-panel";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RegistrationFieldInput } from "@/components/registration-fields";
import { HomeChapterField } from "@/components/chapter-select";
import { formatPhoneNumber } from "@/lib/phone";
import {
  firstIncompleteSection,
  incompleteSectionMessage,
  isSectionComplete,
  secondContactProblem,
  REGISTRATION_SECTIONS,
  sectionsForEvent,
} from "@/lib/registration-sections";
import type { Chapter } from "@/lib/chapters";
import { CORE_PROFILE_FIELDS, type CoreProfileKey } from "@/lib/core-profile";

const DIRECTORY_FIELD = REGISTRATION_SECTIONS.find((s) => s.id === "directory")!.fields[0];

type WalkupFormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  emergencyContact2Name: string;
  emergencyContact2Phone: string;
  emergencyContact2Relationship: string;
  directoryOptIn: boolean;
  chapter: string;
};

const EMPTY_WALKUP_FORM: WalkupFormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelationship: "",
  emergencyContact2Name: "",
  emergencyContact2Phone: "",
  emergencyContact2Relationship: "",
  directoryOptIn: false,
  chapter: "",
};

/**
 * The roster's "Add walk-up" dialog: find or type the person, look up their
 * waiver and what's already on file, ask only for what's missing, then add
 * them (addWalkupRsvpAction), confirming a volunteer conflict or going over
 * capacity first. Mounted fresh each time it opens, so nothing carries over
 * from the last person.
 */
export function RosterWalkupDialog({
  eventId,
  registrationSectionIds,
  chapters,
  onClose,
}: {
  eventId: number;
  /** The event's registration_sections ids — the walk-up form collects the
   * same sections the RSVP form would. */
  registrationSectionIds: string[];
  /** Every chapter (loadChapters), for the home chapter field. */
  chapters: Chapter[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [walkupForm, setWalkupForm] = useState<WalkupFormState>(EMPTY_WALKUP_FORM);
  const [walkupError, setWalkupError] = useState<string | null>(null);
  const [isSubmittingWalkup, setIsSubmittingWalkup] = useState(false);
  const [capacityConfirmPending, setCapacityConfirmPending] = useState(false);
  // The walk-up is signed up to volunteer here: their shifts while the
  // warning is showing, and whether the admin already said "add anyway" (kept
  // when a capacity confirmation follows, so it isn't asked twice).
  const [volunteerConflictShifts, setVolunteerConflictShifts] = useState<string[] | null>(null);
  const [volunteerConflictAcked, setVolunteerConflictAcked] = useState(false);

  // The event's own sections the walk-up form collects — the same catalog-
  // driven sections the RSVP form shows. The emergency contact and directory
  // choice have their own fields above; the waiver has its own block below.
  const walkupSections = useMemo(
    () =>
      sectionsForEvent(registrationSectionIds).filter(
        (section) => !section.alwaysRequired && section.kind !== "waiver",
      ),
    [registrationSectionIds],
  );

  // What we know about the person, looked up by email: their waiver situation
  // (nothing to do, already signed, or the waiver to sign at the check-in
  // table) and what their profile already has for the sections above.
  const [walkupLookup, setWalkupLookup] = useState<{
    info: WaiverInfo;
    profileFields: Record<string, string> | null;
    existing: { name: string; missingCore: CoreProfileKey[] } | null;
    eventEnded: boolean;
  } | null>(null);
  const [walkupSign, setWalkupSign] = useState<WaiverSignState>(EMPTY_WAIVER_SIGN);
  // The fallback behind "They signed a paper waiver instead": `open` swaps
  // the signing block for the paper confirmation, `held` is the lead's tick
  // that they hold the signed copy.
  const [walkupPaper, setWalkupPaper] = useState({ open: false, held: false });
  // After the event there's no signing here: the lead's tick that there's
  // no waiver at all, to record their attendance anyway ("No waiver on file").
  const [walkupNoWaiver, setWalkupNoWaiver] = useState(false);
  // The latest matches for what's typed in the walk-up's Name or email
  // field, so Continue can tell "nobody found" from "found, not picked".
  const [walkupMatches, setWalkupMatches] = useState<EventPersonCandidate[] | null>(null);
  const [walkupSectionValues, setWalkupSectionValues] = useState<Record<string, string>>({});
  // Bumped whenever the section inputs are re-seeded, so stateful inputs
  // (e.g. the dietary Yes/No) remount and pick up the new values.
  const [walkupSectionsKey, setWalkupSectionsKey] = useState(0);

  // Every event has a waiver, so the lookup is always needed.

  /** Seeds values from the profile for anything they haven't typed yet. */
  const withProfileValues = (
    typed: Record<string, string>,
    profileFields: Record<string, string> | null,
  ) => {
    const merged = { ...typed };
    for (const [key, value] of Object.entries(profileFields ?? {})) {
      if (value && !merged[key]) merged[key] = value;
    }
    return merged;
  };

  const lookUpWalkup = async (
    email: string,
  ): Promise<{
    info: WaiverInfo;
    profileFields: Record<string, string> | null;
    existing: { name: string; missingCore: CoreProfileKey[] } | null;
    eventEnded: boolean;
  } | null> => {
    if (!email.trim()) return null;
    const result = await walkupLookupAction(eventId, email);
    if (!result.ok) {
      setWalkupError(result.error);
      return null;
    }
    const lookup = {
      info: result.info,
      profileFields: result.profileFields,
      existing: result.existing,
      eventEnded: result.eventEnded,
    };
    setWalkupLookup(lookup);
    setWalkupSectionValues((prev) => withProfileValues(prev, result.profileFields));
    setWalkupSectionsKey((k) => k + 1);
    return lookup;
  };

  // What the walk-up form asks once the email is looked up: everything for
  // someone new; for someone already in the system, only the core fields
  // blank on their record and the event's sections not complete on file
  // (plus the waiver, if unsigned). Typed values only ever fill blanks.
  const walkupIsNew = walkupLookup != null && walkupLookup.existing == null;
  const walkupAsks = (field: CoreProfileKey) =>
    walkupLookup != null && (walkupLookup.existing?.missingCore ?? CORE_PROFILE_FIELDS.map((f) => f.key)).includes(field);
  const walkupSectionsAsked = walkupLookup
    ? walkupSections.filter((section) => walkupIsNew || !isSectionComplete(section, walkupLookup.profileFields ?? {}))
    : [];
  const walkupFirstName = walkupForm.firstName.trim() || walkupLookup?.existing?.name.split(" ")[0] || "";

  // A different email is a different person: drop their lookup, and any
  // answers that were pre-filled from the previous person's profile so they
  // can't carry over.
  const changeWalkupEmail = (email: string) => {
    setWalkupForm((prev) => ({ ...prev, email }));
    setWalkupError(null);
    if (walkupLookup?.profileFields) {
      setWalkupSectionValues({});
      setWalkupSectionsKey((k) => k + 1);
    }
    setWalkupLookup(null);
    setWalkupPaper({ open: false, held: false });
    setWalkupNoWaiver(false);
    setWalkupMatches(null);
    setVolunteerConflictShifts(null);
    setVolunteerConflictAcked(false);
  };

  const closeWalkupForm = () => {
    if (isSubmittingWalkup) return;
    onClose();
  };

  const updateWalkupField =
    (field: keyof WalkupFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setWalkupForm((prev) => ({ ...prev, [field]: e.target.value }));

  const updateWalkupPhoneField =
    (field: "phone" | "emergencyContactPhone" | "emergencyContact2Phone") => (e: React.ChangeEvent<HTMLInputElement>) =>
      setWalkupForm((prev) => ({
        ...prev,
        [field]: formatPhoneNumber(e.target.value),
      }));

  const submitWalkup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingWalkup(true);
    setWalkupError(null);

    // Email first: until it's been looked up, submitting (Continue, or
    // Enter in the email field) only looks it up, so the lead sees whether
    // they're already on file before anything else is asked or added.
    // Continue with nothing picked: an email is looked up exactly (which
    // also finds people outside the search's chapter scope); anything else
    // asks for one.
    const lookup = walkupLookup;
    if (!lookup) {
      if (isEmailAddress(walkupForm.email)) {
        await lookUpWalkup(walkupForm.email);
      } else {
        setWalkupError(
          walkupMatches && walkupMatches.length > 0
            ? "Pick them from the list, or type their email address."
            : "No one found by that name. Type their email address instead.",
        );
      }
      setIsSubmittingWalkup(false);
      return;
    }
    const sectionValues = withProfileValues(walkupSectionValues, lookup.profileFields);

    const info = lookup.info;
    const onPaper = info.status === "unsigned" && walkupPaper.open;
    if (onPaper && !walkupPaper.held) {
      setIsSubmittingWalkup(false);
      setWalkupError("Tick the box to confirm you hold their signed paper waiver.");
      return;
    }
    const noWaiverOnFile = info.status === "unsigned" && lookup.eventEnded && !onPaper;
    if (noWaiverOnFile && !walkupNoWaiver) {
      setIsSubmittingWalkup(false);
      setWalkupError("Record the paper waiver you hold, or tick No waiver on file.");
      return;
    }
    if (!onPaper && !noWaiverOnFile && waiverNeedsInput(info, walkupSign)) {
      setIsSubmittingWalkup(false);
      setWalkupError(
        info.status === "unavailable"
          ? info.message
          : "Have them read and agree to the waiver below, and type their full name.",
      );
      return;
    }
    const secondContactError = secondContactProblem(walkupForm.emergencyContact2Name, walkupForm.emergencyContact2Phone);
    if (secondContactError) {
      setIsSubmittingWalkup(false);
      setWalkupError(secondContactError);
      return;
    }
    const incomplete = firstIncompleteSection(walkupSections, sectionValues);
    if (incomplete) {
      setIsSubmittingWalkup(false);
      setWalkupError(incompleteSectionMessage(incomplete, sectionValues, " below."));
      return;
    }

    const result = await addWalkupRsvpAction({
      eventId,
      firstName: walkupForm.firstName,
      lastName: walkupForm.lastName,
      email: walkupForm.email,
      phone: walkupForm.phone,
      emergencyContactName: walkupForm.emergencyContactName,
      emergencyContactPhone: walkupForm.emergencyContactPhone,
      emergencyContactRelationship: walkupForm.emergencyContactRelationship,
      emergencyContact2Name: walkupForm.emergencyContact2Name,
      emergencyContact2Phone: walkupForm.emergencyContact2Phone,
      emergencyContact2Relationship: walkupForm.emergencyContact2Relationship,
      directoryOptIn: walkupForm.directoryOptIn,
      chapter: walkupForm.chapter,
      waiverName: walkupSign.name,
      waiverAgreed: walkupSign.agreed,
      paperWaiverHeld: onPaper,
      noWaiverOnFile,
      sections: sectionValues,
      allowVolunteerConflict: volunteerConflictAcked || volunteerConflictShifts != null,
      force: capacityConfirmPending,
    });

    setIsSubmittingWalkup(false);

    if (!result.ok) {
      setWalkupError(result.error);
      return;
    }
    if (result.status === "volunteer_conflict") {
      setVolunteerConflictShifts(result.shifts);
      return;
    }
    if (volunteerConflictShifts) {
      setVolunteerConflictAcked(true);
      setVolunteerConflictShifts(null);
    }
    if (result.status === "capacity_exceeded") {
      setCapacityConfirmPending(true);
      return;
    }

    onClose();
    router.refresh();
  };

  return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <Card className="max-h-[90vh] w-full max-w-sm overflow-y-auto sm:max-w-md">
          <form onSubmit={submitWalkup}>
            <CardHeader>
              <CardTitle>Add walk-up</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* One field: a name or email to search with until someone
                  is found (or an email is looked up), then their email.
                  Editing it afterwards starts the search over. */}
              <div className="grid gap-2">
                <Label htmlFor="walkup_email">{walkupLookup ? "Email" : "Name or email"}</Label>
                <Input
                  id="walkup_email"
                  type={walkupLookup ? "email" : "text"}
                  autoComplete="off"
                  autoFocus
                  required
                  value={walkupForm.email}
                  onChange={(e) => changeWalkupEmail(e.target.value)}
                />
                {!walkupLookup && (
                  <>
                    <EventPersonResults
                      eventId={eventId}
                      query={walkupForm.email}
                      onResults={setWalkupMatches}
                      emptyText={
                        isEmailAddress(walkupForm.email)
                          ? "No match in your search. Press Continue to look this email up."
                          : "No one found. Try another spelling, or type their email address."
                      }
                      onPick={(person) => {
                        changeWalkupEmail(person.email);
                        void lookUpWalkup(person.email);
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      We&apos;ll check whether they&apos;re already in the system first.
                    </p>
                  </>
                )}
              </div>
              {walkupLookup?.existing && (
                <div className="grid gap-1 rounded-md border bg-muted/50 p-3">
                  <span className="font-medium">{walkupLookup.existing.name || walkupForm.email.trim()}</span>
                  <span className="text-sm text-muted-foreground">
                    Already in the system. We have their details on file
                    {walkupLookup.existing.missingCore.length > 0 || walkupSectionsAsked.length > 0
                      ? ", apart from what's asked below"
                      : ""}
                    .
                  </span>
                </div>
              )}
              {(walkupAsks("first_name") || walkupAsks("last_name")) && (
                <div className="grid grid-cols-2 gap-4">
                  {walkupAsks("first_name") && (
                    <div className="grid gap-2">
                      <Label htmlFor="walkup_first_name">First name</Label>
                      <Input
                        id="walkup_first_name"
                        required
                        autoComplete="given-name"
                        value={walkupForm.firstName}
                        onChange={updateWalkupField("firstName")}
                      />
                    </div>
                  )}
                  {walkupAsks("last_name") && (
                    <div className="grid gap-2">
                      <Label htmlFor="walkup_last_name">Last name</Label>
                      <Input
                        id="walkup_last_name"
                        required
                        autoComplete="family-name"
                        value={walkupForm.lastName}
                        onChange={updateWalkupField("lastName")}
                      />
                    </div>
                  )}
                </div>
              )}
              {walkupAsks("phone") && (
                <div className="grid gap-2">
                  <Label htmlFor="walkup_phone">Phone</Label>
                  <Input
                    id="walkup_phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="(303) 555-0100"
                    maxLength={14}
                    required
                    value={walkupForm.phone}
                    onChange={updateWalkupPhoneField("phone")}
                  />
                </div>
              )}
              {/* Same shape as the RSVP form: one contact required
                  (relationship optional), a second one optional. */}
              {(walkupAsks("emergency_contact") || walkupAsks("emergency_phone")) && (
                <EmergencyContactFields
                  title="Emergency contact"
                  idPrefix="walkup_ec1"
                  required
                  relationshipOptional
                  name={walkupForm.emergencyContactName}
                  phone={walkupForm.emergencyContactPhone}
                  relationship={walkupForm.emergencyContactRelationship}
                  onName={updateWalkupField("emergencyContactName")}
                  onPhone={updateWalkupPhoneField("emergencyContactPhone")}
                  onRelationship={updateWalkupField("emergencyContactRelationship")}
                />
              )}
              {walkupIsNew && (
                <EmergencyContactFields
                  title="Second emergency contact (optional)"
                  idPrefix="walkup_ec2"
                  name={walkupForm.emergencyContact2Name}
                  phone={walkupForm.emergencyContact2Phone}
                  relationship={walkupForm.emergencyContact2Relationship}
                  onName={updateWalkupField("emergencyContact2Name")}
                  onPhone={updateWalkupPhoneField("emergencyContact2Phone")}
                  onRelationship={updateWalkupField("emergencyContact2Relationship")}
                />
              )}
              {walkupAsks("chapter") && (
                <HomeChapterField
                  idPrefix="walkup"
                  value={walkupForm.chapter}
                  onChange={(value) => setWalkupForm((prev) => ({ ...prev, chapter: value }))}
                  required
                  chapters={chapters}
                />
              )}
              {walkupIsNew && (
                <RegistrationFieldInput
                  field={DIRECTORY_FIELD}
                  value={walkupForm.directoryOptIn ? "true" : "false"}
                  onChange={(_key, value) =>
                    setWalkupForm((prev) => ({
                      ...prev,
                      directoryOptIn: value === "true",
                    }))
                  }
                />
              )}
              {walkupSectionsAsked.map((section) => (
                <RegistrationSectionField
                  key={`${section.id}-${walkupSectionsKey}`}
                  section={section}
                  profileFields={walkupLookup?.profileFields ?? {}}
                  fieldValues={walkupSectionValues}
                  onChange={(key, value) =>
                    setWalkupSectionValues((prev) => ({ ...prev, [key]: value }))
                  }
                  requiredNote="Required — none on file yet."
                />
              ))}
              {walkupLookup && (
                <div className="grid gap-1 rounded-md border p-3">
                  <span className="text-sm font-medium">Liability waiver</span>
                  {walkupLookup.info.status === "unsigned" && walkupPaper.open ? (
                    <div className="grid gap-3">
                      <p className="text-sm font-medium">Paper waiver — this event only</p>
                      <p className="text-sm text-muted-foreground">
                        Only for when they couldn&apos;t sign here. It covers this event and nothing
                        else: they&apos;ll be asked to sign in the portal at their next one.
                      </p>
                      <label className="flex items-start gap-2 text-sm font-medium">
                        <input
                          id="walkup_paper_waiver_held"
                          type="checkbox"
                          className="mt-1"
                          checked={walkupPaper.held}
                          onChange={(e) => setWalkupPaper({ open: true, held: e.target.checked })}
                        />
                        I hold their signed paper waiver for this event
                      </label>
                      <p className="text-xs text-muted-foreground">
                        Recorded with your name and the time.
                      </p>
                      <button
                        type="button"
                        className="w-fit text-sm underline underline-offset-4"
                        onClick={() => setWalkupPaper({ open: false, held: false })}
                      >
                        {walkupLookup.eventEnded ? "No paper waiver?" : "Sign here instead"}
                      </button>
                    </div>
                  ) : walkupLookup.info.status === "unsigned" && walkupLookup.eventEnded ? (
                    // After the event they usually aren't there, and a
                    // signature typed now would count for the whole year:
                    // no signing here (addWalkupRsvpAction refuses it too).
                    <div className="grid gap-3">
                      <p className="text-sm text-muted-foreground">
                        This event has ended, so they can&apos;t sign in the portal for it now.
                      </p>
                      <button
                        type="button"
                        className="w-fit text-sm underline underline-offset-4"
                        onClick={() => {
                          setWalkupNoWaiver(false);
                          setWalkupPaper({ open: true, held: false });
                        }}
                      >
                        I hold their signed paper waiver
                      </button>
                      <label className="flex items-start gap-2 text-sm font-medium">
                        <input
                          id="walkup_no_waiver"
                          type="checkbox"
                          className="mt-1"
                          checked={walkupNoWaiver}
                          onChange={(e) => setWalkupNoWaiver(e.target.checked)}
                        />
                        No waiver on file: record their attendance anyway
                      </label>
                      <p className="text-xs text-muted-foreground">
                        Flagged on the roster and in the admin digest, with your name and the time,
                        so it can be followed up. It isn&apos;t a waiver: they still sign before
                        their next event.
                      </p>
                    </div>
                  ) : (
                    <>
                      <WaiverSigning
                        info={walkupLookup.info}
                        value={walkupSign}
                        onChange={setWalkupSign}
                        idPrefix="walkup"
                      />
                      {/* Deliberately a quiet link, not a button beside the
                          signing fields: signing here stays the obvious path. */}
                      {walkupLookup.info.status === "unsigned" && (
                        <button
                          type="button"
                          className="mt-2 w-fit text-xs text-muted-foreground underline underline-offset-4"
                          onClick={() => setWalkupPaper({ open: true, held: false })}
                        >
                          They signed a paper waiver instead
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
              {volunteerConflictShifts && (
                <RevealPanel role="alert" className="text-sm text-amber-600">
                  {walkupFirstName || "This person"} is signed up to volunteer at this event (
                  {volunteerConflictShifts.join("; ")}). People normally attend or volunteer, not
                  both. Add them as a participant anyway? Their volunteer{" "}
                  {volunteerConflictShifts.length === 1 ? "shift stays" : "shifts stay"} as{" "}
                  {volunteerConflictShifts.length === 1 ? "it is" : "they are"}.
                </RevealPanel>
              )}
              {capacityConfirmPending && (
                <RevealPanel role="alert" className="text-sm text-amber-600">
                  This event is at capacity. Add {walkupFirstName || "them"} anyway?
                </RevealPanel>
              )}
              {walkupError && (
                <RevealPanel role="alert" revealKey={walkupError} className="text-sm text-red-500">
                  {walkupError}
                </RevealPanel>
              )}
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={closeWalkupForm}
                disabled={isSubmittingWalkup}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmittingWalkup}>
                {isSubmittingWalkup
                  ? "Adding..."
                  : !walkupLookup
                    ? "Continue"
                    : capacityConfirmPending || volunteerConflictShifts
                      ? "Add anyway"
                      : "Add walk-up"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
  );
}
