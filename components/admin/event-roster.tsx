"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { addWalkupRsvpAction, removePaperWaiverAction } from "@/lib/actions/admin-walkup";
import { updateRosterPersonDetailsAction } from "@/lib/actions/roster-person";
import { walkupLookupAction } from "@/lib/actions/waiver";
import { RegistrationSectionField } from "@/components/registration-section-field";
import {
  EMPTY_WAIVER_SIGN,
  WaiverSigning,
  waiverNeedsInput,
  type WaiverSignState,
} from "@/components/waiver-signing";
import type { WaiverInfo } from "@/lib/waivers";
import { adminOfferSpotAction, adminRemoveRsvpAction } from "@/lib/actions/admin-waitlist";
import { adminAddVolunteerSignupAction } from "@/lib/actions/admin-volunteer-signup";
import { CancelEventDialog } from "@/components/admin/cancel-event-dialog";
import { RestoreEventDialog } from "@/components/admin/restore-event-dialog";
import { SaveAsTemplateButton } from "@/components/admin/save-as-template-button";
import { ShareEventCard } from "@/components/admin/share-event-card";
import { EventCard, type EventCardEvent } from "@/components/event-card";
import { EmergencyContactFields } from "@/components/emergency-contact-fields";
import { EventPersonResults, EventPersonSearch } from "@/components/admin/event-person-search";
import type { EventPersonCandidate } from "@/lib/actions/event-people";
import { isEmailAddress } from "@/lib/profile-email";
import { Button } from "@/components/ui/button";
import { RevealPanel } from "@/components/reveal-panel";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { RegistrationFieldInput } from "@/components/registration-fields";
import { HomeChapterField } from "@/components/chapter-select";
import { formatPhoneNumber } from "@/lib/phone";
import {
  dietaryDisplay,
  firstIncompleteSection,
  incompleteSectionMessage,
  isSectionComplete,
  secondContactProblem,
  REGISTRATION_SECTIONS,
  rosterAnswerSections,
  rosterSectionAnswer,
  sectionsForEvent,
  type RegistrationSection,
} from "@/lib/registration-sections";
import { cn } from "@/lib/utils";
import type {
  RosterDietary,
  RosterPerson,
  RosterWaiver,
  VolunteerRoleSummary,
  VolunteerRosterPerson,
  WaitlistPerson,
} from "@/lib/admin/roster";
import { spotsLeft as computeSpotsLeft } from "@/lib/event-capacity";
import { RosterHealthLine, type RosterHealth } from "@/components/admin/roster-health";
import { practicalCheckSummary, type PracticalCheck } from "@/lib/practical-checks";
import type { Chapter } from "@/lib/chapters";
import { personDisplayName } from "@/lib/person-name";
import { CORE_PROFILE_FIELDS, type CoreProfileKey } from "@/lib/core-profile";
import { isAfterEvent, type EventTiming } from "@/lib/event-timing";
import { formatEventInstant } from "@/lib/format-date";

type LatestPracticalCheck = Pick<PracticalCheck, "outcome" | "checked_on" | "assessor_name">;


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

export function EventRoster({
  eventId,
  eventCard,
  timing,
  status,
  cancellationReason,
  initialRoster,
  initialWaitlist,
  waiver,
  dietary,
  registrationSectionIds,
  virtualLink,
  virtualAccessNotes,
  volunteerRoles,
  initialVolunteerRoster,
  seriesId,
  volunteersCancelledWithEvent,
  share,
  canSaveAsTemplate = false,
  canRemovePaperWaiver = false,
  canCancel = false,
  lead,
  health,
  practicalChecks = null,
  unregisteredVolunteerIds = [],
  chapters,
}: {
  eventId: number;
  eventCard: EventCardEvent;
  /** The event's own start/end and timezone — each check-in shows when it
   * was entered, and whether that was after the event. */
  timing: EventTiming;
  status: string;
  cancellationReason: string | null;
  initialRoster: RosterPerson[];
  initialWaitlist: WaitlistPerson[];
  waiver: RosterWaiver;
  dietary: RosterDietary;
  /** The event's registration_sections ids — the walk-up form collects the
   * same sections the RSVP form would. */
  registrationSectionIds: string[];
  /** Shown to the admin regardless of their own RSVP status — unlike
   * EventCardEvent's virtualLink (participant-facing, gated to a confirmed
   * RSVP), an admin managing the event always sees it. */
  virtualLink: string | null;
  virtualAccessNotes: string | null;
  /** Every volunteer role at the event, filled vs needed — empty when the
   * event has none. */
  volunteerRoles: VolunteerRoleSummary[];
  initialVolunteerRoster: VolunteerRosterPerson[];
  /** Set for an occurrence of a repeating series. */
  seriesId: string | null;
  /** Volunteer signups the event's cancellation cancelled (0 unless cancelled). */
  volunteersCancelledWithEvent: number;
  /** For the "Share" block (public link + QR): the public page's URL, from
   * the server page, which knows the site URL. Plain data, not a rendered
   * element — an element made by the server page and dropped in among this
   * component's children was what React's "unique key" warning was about. */
  share: { url: string; slug: string; published: boolean };
  /** Templates are admin-only setup, so a chapter lead doesn't get "Save as
   * template". */
  canSaveAsTemplate?: boolean;
  /** Admins only: undo a paper waiver record entered by mistake. A chapter
   * lead can record one but not remove it. */
  canRemovePaperWaiver?: boolean;
  /** Cancel and restore: admins and the event's chapter lead(s) only — not
   * someone who just leads this event. Both email everyone registered. */
  canCancel?: boolean;
  /** Who leads the event: the assigned account's own name (it has manage
   * rights), and the free-text contact name attendees see. Either can be
   * missing, and they can differ. */
  lead: {
    assignedName: string | null;
    contactName: string;
    /** Set when the lead was assigned automatically: their account arrived
     * after the event already named their email (assign_lead_events). */
    autoAssignedOn: string | null;
  };
  /** Health form status for everyone, markers only for a health-access
   * viewer (see RosterHealthLine). */
  health: RosterHealth;
  /** Latest practical instruction check per volunteer on an instructor
   * shift — only at an event that requires health history, and only for
   * admins and chapter leads; null otherwise (nothing shown). */
  practicalChecks?: Record<string, LatestPracticalCheck> | null;
  /** Volunteers on this roster who hadn't completed volunteer registration
   * by their shift's date (event_unregistered_volunteer_ids) — flagged so
   * they can be chased. */
  unregisteredVolunteerIds?: string[];
  /** Every chapter (loadChapters) — the walk-up form's home chapter and
   * "Save as template". */
  chapters: Chapter[];
}) {
  const router = useRouter();
  const isCancelled = status === "cancelled";

  // Local copy for optimistic check-in toggles, replaced whenever a fresh
  // server load arrives (router.refresh() after a walk-up, removal, …).
  // Compared DURING render — React's "adjusting state when a prop changes"
  // pattern — so no render ever shows the old rows; a useEffect resync
  // commits one stale render first. Not a `key` on this component: that
  // would also wipe the search box, open forms, and messages on every refresh.
  const [roster, setRoster] = useState<RosterPerson[]>(initialRoster);
  const [rosterSource, setRosterSource] = useState(initialRoster);
  if (rosterSource !== initialRoster) {
    setRosterSource(initialRoster);
    setRoster(initialRoster);
  }

  const waitlist = initialWaitlist;
  const [busyRsvpId, setBusyRsvpId] = useState<number | null>(null);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);

  // Same during-render resync as `roster` above.
  const [volunteerRoster, setVolunteerRoster] = useState<VolunteerRosterPerson[]>(
    initialVolunteerRoster,
  );
  const [volunteerRosterSource, setVolunteerRosterSource] = useState(initialVolunteerRoster);
  if (volunteerRosterSource !== initialVolunteerRoster) {
    setVolunteerRosterSource(initialVolunteerRoster);
    setVolunteerRoster(initialVolunteerRoster);
  }
  const [volunteerCheckInError, setVolunteerCheckInError] = useState<string | null>(null);

  // eventCard.spots_taken already includes spots held by open offers, so
  // this is what's genuinely free to offer right now.
  const freeSpots =
    computeSpotsLeft(eventCard.capacity, eventCard.spots_taken) ?? Number.POSITIVE_INFINITY; // null = unlimited

  const runWaitlistAction = async (
    rsvpId: number,
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
  ) => {
    setBusyRsvpId(rsvpId);
    setWaitlistError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setWaitlistError(result.error);
        return;
      }
      router.refresh();
    } catch (err) {
      console.error("Roster action failed:", err);
      setWaitlistError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setBusyRsvpId(null);
    }
  };

  const offerSpot = (person: WaitlistPerson) =>
    runWaitlistAction(person.rsvpId, () => adminOfferSpotAction(person.rsvpId));

  // Two-step remove with an in-page confirmation. Not window.confirm: some
  // embedded browsers (e.g. an editor's preview pane) block modal dialogs and
  // return false without showing anything, which made Remove look dead.
  const [pendingRemoval, setPendingRemoval] = useState<{
    rsvpId: number;
    name: string;
    warning: string;
  } | null>(null);

  const removePerson = (
    person: { rsvpId: number; firstName: string; lastName: string },
    warning: string,
  ) => {
    const name = `${person.firstName} ${person.lastName}`.trim() || "this person";
    setWaitlistError(null);
    setPendingRemoval({ rsvpId: person.rsvpId, name, warning });
  };

  const removePaperWaiver = (person: RosterPerson) =>
    runWaitlistAction(person.rsvpId, () => removePaperWaiverAction(person.rsvpId));

  const confirmRemoval = async () => {
    if (!pendingRemoval) return;
    const { rsvpId } = pendingRemoval;
    setPendingRemoval(null);
    await runWaitlistAction(rsvpId, () => adminRemoveRsvpAction(rsvpId, eventId));
  };

  // Rendered as its own list item directly under the person's row (roster or
  // waitlist), not above the lists, so it opens next to the Remove clicked.
  const removalConfirm = pendingRemoval && (
    <li className="list-none pb-3">
      <RevealPanel
        aria-label={`Remove ${pendingRemoval.name}?`}
        className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
      >
        <p className="font-medium">Remove {pendingRemoval.name}?</p>
        <p className="mt-1 text-muted-foreground">{pendingRemoval.warning}</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={confirmRemoval}>
            Yes, remove
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPendingRemoval(null)}>
            Keep
          </Button>
        </div>
      </RevealPanel>
    </li>
  );

  const [search, setSearch] = useState("");
  const [checkInError, setCheckInError] = useState<string | null>(null);

  const [showWalkupForm, setShowWalkupForm] = useState(false);
  const [walkupForm, setWalkupForm] = useState<WalkupFormState>(EMPTY_WALKUP_FORM);
  const [walkupError, setWalkupError] = useState<string | null>(null);
  const [isSubmittingWalkup, setIsSubmittingWalkup] = useState(false);
  const [capacityConfirmPending, setCapacityConfirmPending] = useState(false);
  // The walk-up is signed up to volunteer here: their shifts while the
  // warning is showing, and whether the admin already said "add anyway" (kept
  // when a capacity confirmation follows, so it isn't asked twice).
  const [volunteerConflictShifts, setVolunteerConflictShifts] = useState<string[] | null>(null);
  const [volunteerConflictAcked, setVolunteerConflictAcked] = useState(false);

  const [showAddVolunteerForm, setShowAddVolunteerForm] = useState(false);
  const [addVolunteerEmail, setAddVolunteerEmail] = useState("");
  // Whether the event had started when Add volunteer was opened: it may be
  // recording a shift after the fact (adminAddVolunteerSignupAction marks an
  // ended shift as served and sends no emails), and the form says so.
  const [addVolunteerEventStarted, setAddVolunteerEventStarted] = useState(false);
  const [addVolunteerOpportunityId, setAddVolunteerOpportunityId] = useState("");
  const [addVolunteerError, setAddVolunteerError] = useState<string | null>(null);
  const [isAddingVolunteer, setIsAddingVolunteer] = useState(false);
  // Set once the action reports something that needs an explicit override —
  // "not approved for this role", "already RSVP'd to attend", or "shift is
  // full" — then cleared on any further edit, same two-step confirm shape as
  // the walk-up capacity flow. Overrides already confirmed are remembered
  // (addVolunteerAcked) so a later check doesn't send the admin back to one.
  const [addVolunteerConfirm, setAddVolunteerConfirm] = useState<
    "not_approved" | "has_rsvp" | "capacity" | "practical_check" | "registration" | null
  >(null);
  // An admin's reason for adding someone past a missing practical check.
  const [practicalOverrideReason, setPracticalOverrideReason] = useState("");
  // An admin's reason for adding someone who hasn't completed registration.
  const [registrationOverrideReason, setRegistrationOverrideReason] = useState("");
  const [addVolunteerAcked, setAddVolunteerAcked] = useState<Set<string>>(() => new Set());
  // Their RSVP to attend, when the has_rsvp warning is showing.
  const [addVolunteerRsvpStatus, setAddVolunteerRsvpStatus] = useState<string | null>(null);
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

  // The event's sections whose answers the volunteer rows show — volunteers
  // answer the same ones participants do when they sign up.
  const answerSections = useMemo(
    () => rosterAnswerSections(registrationSectionIds),
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

  const confirmedCount = roster.filter((p) => p.status === "confirmed").length;
  const checkedInCount = roster.filter((p) => p.checkedInAt).length;
  // A paper waiver covers them for this event, so it isn't "not signed" —
  // but it's counted apart from a signature in the portal.
  const unsignedCount = roster.filter((p) => !p.waiverSignedOn && !p.paperWaiver).length;
  const paperOnlyCount = roster.filter((p) => !p.waiverSignedOn && p.paperWaiver).length;

  const filteredRoster = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return roster;
    return roster.filter((p) =>
      [p.firstName, p.lastName, p.email, p.phone].join(" ").toLowerCase().includes(query),
    );
  }, [roster, search]);

  const toggleCheckIn = async (person: RosterPerson) => {
    setCheckInError(null);
    const previous = person.checkedInAt;
    const next = previous ? null : new Date().toISOString();

    // Optimistic — flip local state immediately so it feels instant, then
    // reconcile with the write; roll back only on failure.
    setRoster((prev) =>
      prev.map((p) => (p.rsvpId === person.rsvpId ? { ...p, checkedInAt: next } : p)),
    );

    // The time sent is only a placeholder for "checked in": the database
    // stamps its own (stamp_checked_in_at), and that's what is shown.
    const supabase = createClient();
    const { data, error } = await supabase
      .from("rsvps")
      .update({ checked_in_at: next })
      .eq("id", person.rsvpId)
      .select("checked_in_at")
      .maybeSingle();

    if (data) {
      const stamped = (data.checked_in_at as string | null) ?? null;
      setRoster((prev) =>
        prev.map((p) => (p.rsvpId === person.rsvpId ? { ...p, checkedInAt: stamped } : p)),
      );
    }
    if (error) {
      setRoster((prev) =>
        prev.map((p) => (p.rsvpId === person.rsvpId ? { ...p, checkedInAt: previous } : p)),
      );
      setCheckInError(
        `Couldn't update check-in for ${personDisplayName(person)}: ${error.message}`,
      );
    }
  };

  const toggleVolunteerCheckIn = async (person: VolunteerRosterPerson) => {
    setVolunteerCheckInError(null);
    const previous = person.checkedInAt;
    const next = previous ? null : new Date().toISOString();

    setVolunteerRoster((prev) =>
      prev.map((p) => (p.signupId === person.signupId ? { ...p, checkedInAt: next } : p)),
    );

    const supabase = createClient();
    const { data, error } = await supabase
      .from("volunteer_signups")
      .update({ checked_in_at: next })
      .eq("id", person.signupId)
      .select("checked_in_at")
      .maybeSingle();

    if (data) {
      const stamped = (data.checked_in_at as string | null) ?? null;
      setVolunteerRoster((prev) =>
        prev.map((p) => (p.signupId === person.signupId ? { ...p, checkedInAt: stamped } : p)),
      );
    }
    if (error) {
      setVolunteerRoster((prev) =>
        prev.map((p) => (p.signupId === person.signupId ? { ...p, checkedInAt: previous } : p)),
      );
      setVolunteerCheckInError(
        `Couldn't update check-in for ${personDisplayName(person)}: ${error.message}`,
      );
    }
  };

  const openWalkupForm = () => {
    setWalkupForm(EMPTY_WALKUP_FORM);
    setWalkupError(null);
    setCapacityConfirmPending(false);
    setWalkupLookup(null);
    setWalkupSign(EMPTY_WAIVER_SIGN);
    setWalkupPaper({ open: false, held: false });
    setWalkupNoWaiver(false);
    setWalkupMatches(null);
    setWalkupSectionValues({});
    setWalkupSectionsKey((k) => k + 1);
    setVolunteerConflictShifts(null);
    setVolunteerConflictAcked(false);
    setShowWalkupForm(true);
  };

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
    setShowWalkupForm(false);
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

    setShowWalkupForm(false);
    router.refresh();
  };

  const openAddVolunteerForm = () => {
    setAddVolunteerEmail("");
    setAddVolunteerEventStarted(new Date(timing.startsAt).getTime() <= Date.now());
    setAddVolunteerOpportunityId(volunteerRoles[0] ? String(volunteerRoles[0].opportunityId) : "");
    setAddVolunteerError(null);
    setAddVolunteerConfirm(null);
    setAddVolunteerAcked(new Set());
    setShowAddVolunteerForm(true);
  };

  // Any edit to who/which role invalidates earlier confirmations.
  const resetAddVolunteerConfirm = () => {
    setAddVolunteerConfirm(null);
    setAddVolunteerAcked(new Set());
    setAddVolunteerError(null);
    setPracticalOverrideReason("");
    setRegistrationOverrideReason("");
  };

  const closeAddVolunteerForm = () => {
    if (isAddingVolunteer) return;
    setShowAddVolunteerForm(false);
  };

  const submitAddVolunteer = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAddingVolunteer(true);
    setAddVolunteerError(null);

    if (addVolunteerConfirm === "practical_check" && !practicalOverrideReason.trim()) {
      setIsAddingVolunteer(false);
      setAddVolunteerError("Give a reason for adding them without a passed practical check.");
      return;
    }
    if (addVolunteerConfirm === "registration" && !registrationOverrideReason.trim()) {
      setIsAddingVolunteer(false);
      setAddVolunteerError("Give a reason for adding them before they've registered.");
      return;
    }
    const acked = new Set(addVolunteerAcked);
    if (addVolunteerConfirm) acked.add(addVolunteerConfirm);
    setAddVolunteerAcked(acked);

    const result = await adminAddVolunteerSignupAction({
      opportunityId: Number(addVolunteerOpportunityId),
      email: addVolunteerEmail,
      overrideApproval: acked.has("not_approved"),
      overrideRsvp: acked.has("has_rsvp"),
      forceCapacity: acked.has("capacity"),
      practicalCheckOverrideReason: acked.has("practical_check") ? practicalOverrideReason : undefined,
      registrationOverrideReason: acked.has("registration") ? registrationOverrideReason : undefined,
    });

    setIsAddingVolunteer(false);

    if (!result.ok) {
      setAddVolunteerError(result.error);
      return;
    }
    if (result.status === "has_rsvp") {
      setAddVolunteerConfirm("has_rsvp");
      setAddVolunteerRsvpStatus(result.rsvpStatus);
      setAddVolunteerError(null);
      return;
    }
    if (result.status === "not_approved") {
      const why = result.approvedForRole
        ? "This person is an approved volunteer but not for this specific role."
        : "This person isn't an approved volunteer.";
      // Only an admin can add someone anyway — approving volunteers is
      // admin-only, so a chapter lead just gets the reason.
      if (result.canOverride) {
        setAddVolunteerConfirm("not_approved");
        setAddVolunteerError(why);
      } else {
        setAddVolunteerAcked(new Set());
        setAddVolunteerConfirm(null);
        setAddVolunteerError(`${why} Only an admin can add them — ask an admin to approve them first.`);
      }
      return;
    }
    if (result.status === "capacity_exceeded") {
      setAddVolunteerConfirm("capacity");
      setAddVolunteerError("This shift is full.");
      return;
    }
    if (result.status === "practical_check_required" || result.status === "registration_required") {
      // Chapter leads can't override — they just get the reason.
      if (result.canOverride) {
        setAddVolunteerConfirm(result.status === "practical_check_required" ? "practical_check" : "registration");
      } else {
        setAddVolunteerAcked(new Set());
        setAddVolunteerConfirm(null);
      }
      setAddVolunteerError(result.message);
      return;
    }

    setShowAddVolunteerForm(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <EventCard event={eventCard} rsvpStatus={null} exactSpots />

      {/* Assigned (has access) and merely named (contact details, no
          access) look the same everywhere else, so say which it is. */}
      {lead.assignedName ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Lead:</span>{" "}
          <span className="font-medium">{lead.assignedName}</span>{" "}
          <span className="text-muted-foreground">(can manage this event)</span>
          {lead.contactName && lead.contactName.toLowerCase() !== lead.assignedName.toLowerCase() && (
            <span className="text-muted-foreground"> · shown to attendees as {lead.contactName}</span>
          )}
          {lead.autoAssignedOn && (
            <span className="text-muted-foreground">
              {" "}
              · assigned automatically {lead.autoAssignedOn}, when their account matched the lead email
            </span>
          )}
        </p>
      ) : lead.contactName ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Lead contact:</span>{" "}
          <span className="font-medium">{lead.contactName}</span>{" "}
          <span className="font-medium text-amber-700 dark:text-amber-400">(not assigned — no access)</span>{" "}
          <Link
            href={`/protected/admin/events/${eventId}/edit`}
            className="text-muted-foreground underline underline-offset-4"
          >
            Assign on the edit form
          </Link>
        </p>
      ) : null}

      {virtualLink && (
        <VirtualLinkCard link={virtualLink} accessNotes={virtualAccessNotes} />
      )}

      {isCancelled && (
        <div className="rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          <p className="font-semibold">This event is cancelled.</p>
          {cancellationReason && <p className="mt-1">Reason: {cancellationReason}</p>}
        </div>
      )}

      <ShareEventCard
        url={share.url}
        slug={share.slug}
        published={share.published}
        cancelled={isCancelled}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Capacity" value={eventCard.capacity ?? "—"} />
        <StatTile label="Confirmed" value={confirmedCount} />
        <StatTile label="Checked in" value={checkedInCount} />
        <StatTile label="Waitlist" value={waitlist.length} />
      </div>

      {/* Actions, grouped: what a lead does at the door (primary, large,
        * full width on a phone), then managing the event itself, then the
        * destructive one set apart. Search gets its own full-width row. */}
      <div className="flex flex-col gap-3 rounded-md border p-3">
        {isCancelled ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {canCancel && (
              <RestoreEventDialog
                eventId={eventId}
                eventName={eventCard.name}
                confirmedCount={confirmedCount}
                volunteersCancelledCount={volunteersCancelledWithEvent}
                onRestored={() => router.refresh()}
              />
            )}
            <span className="text-sm text-muted-foreground">
              {canCancel
                ? "Cancelled — restore it to add people again."
                : "Cancelled — an admin or the chapter's lead can restore it. Nobody can be added until then."}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            <Button className="h-11 sm:px-6" onClick={openWalkupForm}>
              Add walk-up
            </Button>
            {volunteerRoles.length > 0 && (
              <Button className="h-11 sm:px-6" variant="outline" onClick={openAddVolunteerForm}>
                Add volunteer
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button asChild variant="outline" size="sm">
            <Link href={`/protected/admin/events/${eventId}/edit`}>Edit event</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/protected/admin/events/${eventId}/print`} target="_blank">
              Print roster
            </Link>
          </Button>
          {/* Its own printout, not part of the roster's: the waiver plus
              blank sign-in pages, for the rare event that needs paper. */}
          <Button asChild variant="outline" size="sm">
            <Link href={`/protected/admin/events/${eventId}/walkup-sheet`} target="_blank">
              Print walk-up sheet
            </Link>
          </Button>
          {health.markers && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/protected/admin/events/${eventId}/health/print`} target="_blank">
                Print health forms
              </Link>
            </Button>
          )}
          {seriesId && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/protected/admin/events/series/${seriesId}`}>View series</Link>
            </Button>
          )}
          {canSaveAsTemplate && (
            <SaveAsTemplateButton
              eventId={eventId}
              eventName={eventCard.name}
              eventChapter={eventCard.chapter}
              chapters={chapters}
            />
          )}
          {!isCancelled && canCancel && (
            <div className="ml-auto">
              <CancelEventDialog
                eventId={eventId}
                eventName={eventCard.name}
                seriesId={seriesId}
                triggerSize="sm"
                onCancelled={() => router.refresh()}
              />
            </div>
          )}
        </div>
      </div>

      <Input
        type="search"
        placeholder="Search by name, email, or phone"
        aria-label="Search the roster"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-11 w-full"
      />

      <div
        className={cn(
          "rounded-md border p-3 text-sm",
          waiver.problem || unsignedCount > 0
            ? "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400"
            : "border-green-600/40 bg-green-600/10",
        )}
      >
        {waiver.problem ? (
          <p className="font-semibold">Waiver: {waiver.problem}</p>
        ) : (
          <p>
            <span className="font-semibold">{waiver.heading}</span> —{" "}
            {unsignedCount > 0
              ? `${unsignedCount} of ${roster.length} on the roster NOT SIGNED`
              : paperOnlyCount > 0
                ? "everyone on the roster is covered"
                : "everyone on the roster has signed"}
            {paperOnlyCount > 0 && ` · ${paperOnlyCount} on a paper waiver for this event only`}
          </p>
        )}
      </div>

      {dietary.collected && (
        <div
          className={cn(
            "rounded-md border p-3 text-sm",
            dietary.notAnsweredCount > 0
              ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : "border-green-600/40 bg-green-600/10",
          )}
        >
          <span className="font-semibold">Dietary</span> —{" "}
          {dietary.notAnsweredCount > 0
            ? `${dietary.notAnsweredCount} of ${roster.length} on the roster haven't answered`
            : "everyone on the roster has answered"}
        </div>
      )}

      {checkInError && (
        <RevealPanel role="alert" revealKey={checkInError} className="text-sm text-red-500">
          {checkInError}
        </RevealPanel>
      )}

      {waitlistError && (
        <RevealPanel
          role="alert"
          revealKey={waitlistError}
          className="rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400"
        >
          {waitlistError}
        </RevealPanel>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Roster ({filteredRoster.length}
            {filteredRoster.length !== roster.length ? ` of ${roster.length}` : ""})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredRoster.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {roster.length === 0 ? "No RSVPs yet." : "No one matches that search."}
            </p>
          ) : (
            <ul>
              {filteredRoster.map((person) => (
                <Fragment key={person.rsvpId}>
                  <RosterRow
                    person={person}
                    timing={timing}
                    collectsDietary={dietary.collected}
                    answerSections={answerSections}
                    onToggleCheckIn={toggleCheckIn}
                    onRemove={(p) =>
                      removePerson(
                        p,
                        "They'll be emailed that their RSVP was cancelled, and the spot goes to the next person on the waitlist.",
                      )
                    }
                    removing={busyRsvpId === person.rsvpId}
                    confirming={pendingRemoval?.rsvpId === person.rsvpId}
                    onRemovePaperWaiver={canRemovePaperWaiver ? removePaperWaiver : undefined}
                    editDetails={
                      <EditDetails eventId={eventId} person={person} onSaved={() => router.refresh()} />
                    }
                    health={
                      <RosterHealthLine
                        eventId={eventId}
                        userId={person.userId}
                        health={health}
                        checkedIn={Boolean(person.checkedInAt)}
                      />
                    }
                  />
                  {pendingRemoval?.rsvpId === person.rsvpId && removalConfirm}
                </Fragment>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Waitlist ({waitlist.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {waitlist.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one is waiting.</p>
          ) : (
            <ul>
              {waitlist.map((person) => (
                <Fragment key={person.rsvpId}>
                  <WaitlistRow
                    person={person}
                    canOffer={!isCancelled && freeSpots > 0}
                    busy={busyRsvpId === person.rsvpId}
                    onOffer={offerSpot}
                    onRemove={(p) =>
                      removePerson(
                        p,
                        p.status === "offered"
                          ? "Their open offer is voided and the spot goes to the next person."
                          : "They'll be taken off the waitlist.",
                      )
                    }
                    confirming={pendingRemoval?.rsvpId === person.rsvpId}
                  />
                  {pendingRemoval?.rsvpId === person.rsvpId && removalConfirm}
                </Fragment>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {volunteerRoles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Volunteers</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {volunteerRoles.map((role) => (
                <span
                  key={role.opportunityId}
                  className="rounded-full border px-3 py-1 text-xs text-muted-foreground"
                >
                  {role.role}: {role.slotsTaken}/{role.slots} filled
                </span>
              ))}
            </div>

            {volunteerCheckInError && (
              <RevealPanel
                role="alert"
                revealKey={volunteerCheckInError}
                className="text-sm text-red-500"
              >
                {volunteerCheckInError}
              </RevealPanel>
            )}

            {volunteerRoster.length === 0 ? (
              <p className="text-sm text-muted-foreground">No one has signed up yet.</p>
            ) : (
              <ul>
                {volunteerRoster.map((person) => (
                  <VolunteerRosterRow
                    key={person.signupId}
                    person={person}
                    timing={timing}
                    editDetails={
                      person.userId && (
                        <EditDetails eventId={eventId} person={person} onSaved={() => router.refresh()} />
                      )
                    }
                    unregistered={unregisteredVolunteerIds.includes(person.userId)}
                    answerSections={answerSections}
                    onToggleCheckIn={toggleVolunteerCheckIn}
                    practicalCheck={
                      practicalChecks && person.instructorShift
                        ? { latest: practicalChecks[person.userId] ?? null }
                        : null
                    }
                    health={
                      <RosterHealthLine
                        eventId={eventId}
                        userId={person.userId}
                        health={health}
                        checkedIn={Boolean(person.checkedInAt)}
                      />
                    }
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {showAddVolunteerForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="max-h-[90vh] w-full max-w-sm overflow-y-auto sm:max-w-md">
            <form onSubmit={submitAddVolunteer}>
              <CardHeader>
                <CardTitle>Add volunteer</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="add_volunteer_role">Role</Label>
                  <Select
                    id="add_volunteer_role"
                    value={addVolunteerOpportunityId}
                    onChange={(e) => {
                      setAddVolunteerOpportunityId(e.target.value);
                      resetAddVolunteerConfirm();
                    }}
                  >
                    {volunteerRoles.map((role) => (
                      <option key={role.opportunityId} value={role.opportunityId}>
                        {role.role} ({role.slotsTaken}/{role.slots} filled)
                      </option>
                    ))}
                  </Select>
                </div>
                <EventPersonSearch
                  eventId={eventId}
                  idPrefix="add_volunteer"
                  onPick={(person) => {
                    setAddVolunteerEmail(person.email);
                    resetAddVolunteerConfirm();
                  }}
                />
                <div className="grid gap-2">
                  <Label htmlFor="add_volunteer_email">Email</Label>
                  <Input
                    id="add_volunteer_email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    autoFocus
                    value={addVolunteerEmail}
                    onChange={(e) => {
                      setAddVolunteerEmail(e.target.value);
                      resetAddVolunteerConfirm();
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    They need an existing account — this doesn&apos;t create one, unlike the
                    participant walk-up flow.
                  </p>
                  {addVolunteerEventStarted && (
                    <p className="text-xs text-muted-foreground">
                      Adding someone to a shift that has already ended records them as having
                      served it, and sends no emails.
                    </p>
                  )}
                </div>
                {addVolunteerConfirm === "has_rsvp" && (
                  <RevealPanel role="alert" className="text-sm text-amber-600">
                    {addVolunteerRsvpStatus === "waitlisted"
                      ? "This person is on the waitlist to attend this event"
                      : addVolunteerRsvpStatus === "offered"
                        ? "This person has an open offer to attend this event"
                        : "This person is RSVP'd to attend this event"}
                    . People normally attend or volunteer, not both. Add them as a volunteer
                    anyway? Their RSVP stays as it is — remove it from the roster if they&apos;re
                    only volunteering.
                  </RevealPanel>
                )}
                {addVolunteerError && (
                  <RevealPanel
                    role="alert"
                    revealKey={`${addVolunteerConfirm}:${addVolunteerError}`}
                    className="text-sm text-red-500"
                  >
                    {addVolunteerError}
                  </RevealPanel>
                )}
                {addVolunteerConfirm === "practical_check" && (
                  <div className="grid gap-2">
                    <Label htmlFor="add_volunteer_override_reason">Reason for adding them anyway</Label>
                    <Textarea
                      id="add_volunteer_override_reason"
                      value={practicalOverrideReason}
                      onChange={(e) => setPracticalOverrideReason(e.target.value)}
                      placeholder="e.g. Assessed on the water last season before checks were recorded here"
                    />
                    <p className="text-xs text-muted-foreground">
                      Recorded on their shift with your name and the time.
                    </p>
                  </div>
                )}
                {addVolunteerConfirm === "registration" && (
                  <div className="grid gap-2">
                    <Label htmlFor="add_volunteer_registration_reason">Reason for adding them anyway</Label>
                    <Textarea
                      id="add_volunteer_registration_reason"
                      value={registrationOverrideReason}
                      onChange={(e) => setRegistrationOverrideReason(e.target.value)}
                      placeholder="e.g. Signed a paper waiver on site; registering after the event"
                    />
                    <p className="text-xs text-muted-foreground">
                      Recorded on their shift with your name and the time. They still need to
                      register before they can sign up for shifts themselves.
                    </p>
                  </div>
                )}
                {(addVolunteerConfirm === "not_approved" || addVolunteerConfirm === "capacity") && (
                  <p className="text-sm text-amber-600">
                    {addVolunteerConfirm === "not_approved"
                      ? "Add them anyway?"
                      : "Add them anyway, over capacity?"}
                  </p>
                )}
              </CardContent>
              <CardFooter className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeAddVolunteerForm}
                  disabled={isAddingVolunteer}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isAddingVolunteer}>
                  {isAddingVolunteer
                    ? "Adding..."
                    : addVolunteerConfirm
                      ? "Add anyway"
                      : "Add volunteer"}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {showWalkupForm && (
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
      )}
    </div>
  );
}

/**
 * Read-only Zoom/meeting link + access notes for the admin managing the
 * event, with a one-tap copy — the lead is often starting the call from a
 * phone on the day of, and shouldn't have to open the Edit form to find it.
 */
function VirtualLinkCard({
  link,
  accessNotes,
}: {
  link: string;
  accessNotes: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. no secure context) — the link is
      // still right there to select and copy by hand.
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-xs text-muted-foreground">Virtual event link</span>
            <p className="truncate text-sm">{link}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        {accessNotes && <p className="text-sm text-muted-foreground">{accessNotes}</p>}
      </CardContent>
    </Card>
  );
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-1 py-4">
        <span className="text-2xl font-bold">{value}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
  );
}

function WaitlistRow({
  person,
  canOffer,
  busy,
  onOffer,
  onRemove,
  confirming,
}: {
  person: WaitlistPerson;
  canOffer: boolean;
  busy: boolean;
  onOffer: (person: WaitlistPerson) => void;
  onRemove: (person: WaitlistPerson) => void;
  /** Their "Remove?" confirmation is open, right below this row. */
  confirming: boolean;
}) {
  const contact = [person.phone, person.email].filter(Boolean).join(" · ");
  const canOfferThis = person.status !== "offered";

  return (
    <li className="flex flex-col gap-3 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
        <span className="font-medium">
          {person.position != null ? `#${person.position} ` : ""}
          {personDisplayName(person)}
        </span>
        <span className="text-sm text-muted-foreground">{contact || "—"}</span>
        {person.status === "waitlisted" && (
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-amber-600">Waitlisted</span> · joined{" "}
            {person.joinedLabel}
          </span>
        )}
        {person.status === "offered" && (
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-green-600">Offered</span> · expires{" "}
            {person.offerExpiresLabel ?? "—"}
          </span>
        )}
        {person.status === "expired" && (
          <span className="text-xs text-muted-foreground">
            <span className="font-medium">Offer expired</span>
            {person.offerExpiresLabel ? ` ${person.offerExpiresLabel}` : ""}
          </span>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        {canOfferThis && (
          <Button
            type="button"
            size="sm"
            disabled={busy || !canOffer}
            title={canOffer ? undefined : "No open spot to offer"}
            onClick={() => onOffer(person)}
          >
            Offer spot now
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || confirming}
          onClick={() => onRemove(person)}
        >
          {confirming ? "Confirm below" : busy ? "Removing..." : "Remove"}
        </Button>
      </div>
    </li>
  );
}

function RosterRow({
  person,
  timing,
  collectsDietary,
  answerSections,
  onToggleCheckIn,
  onRemove,
  removing,
  confirming,
  onRemovePaperWaiver,
  editDetails,
  health,
}: {
  person: RosterPerson;
  timing: EventTiming;
  collectsDietary: boolean;
  /** The event's sections to show answers for (see rosterAnswerSections). */
  answerSections: RegistrationSection[];
  onToggleCheckIn: (person: RosterPerson) => void;
  onRemove: (person: RosterPerson) => void;
  removing: boolean;
  /** Their "Remove?" confirmation is open, right below this row. */
  confirming: boolean;
  /** Set for admins only: removes a paper waiver record entered by mistake. */
  onRemovePaperWaiver?: (person: RosterPerson) => void;
  /** The "Edit details" control. */
  editDetails?: React.ReactNode;
  health: React.ReactNode;
}) {
  const contact = [person.phone, person.email].filter(Boolean).join(" · ");
  const emergency = [person.emergencyContact, person.emergencyPhone].filter(Boolean).join(" · ");
  // Two-step, in the row (no window.confirm — see removePerson above).
  const [confirmingPaperRemoval, setConfirmingPaperRemoval] = useState(false);

  return (
    <li className="flex flex-col gap-3 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
        <span className="font-medium">
          {personDisplayName(person)}
          {person.imported && (
            <span className="ml-2 inline-flex rounded border px-1.5 py-0.5 align-middle text-xs font-medium text-muted-foreground">
              Imported
            </span>
          )}
        </span>
        <span className="text-sm text-muted-foreground">{contact || "—"}</span>
        {editDetails}
        <span className="text-sm text-muted-foreground">Emergency: {emergency || "—"}</span>
        {person.emergencySecondary && (
          <span className="text-sm text-muted-foreground">Second contact: {person.emergencySecondary}</span>
        )}
        {person.paperWaiver ? (
          <>
            <span className="w-fit rounded border border-amber-600 px-2 py-0.5 text-xs font-bold tracking-wide text-amber-700 dark:text-amber-400">
              Paper waiver — this event only
            </span>
            <span className="text-xs text-muted-foreground">
              Recorded by {person.paperWaiver.recordedBy} · {person.paperWaiver.recordedLabel}
            </span>
            {onRemovePaperWaiver &&
              (confirmingPaperRemoval ? (
                <RevealPanel
                  aria-label="Remove this paper waiver record?"
                  className="my-1 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
                >
                  <p className="font-medium">Remove this paper waiver record?</p>
                  <p className="mt-1 text-muted-foreground">
                    For one entered by mistake. They&apos;ll show as WAIVER NOT SIGNED; their place
                    on the roster and check-in stay as they are. The removal is recorded with your
                    name and the time.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      disabled={removing}
                      onClick={() => {
                        setConfirmingPaperRemoval(false);
                        onRemovePaperWaiver(person);
                      }}
                    >
                      Yes, remove the record
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmingPaperRemoval(false)}>
                      Keep
                    </Button>
                  </div>
                </RevealPanel>
              ) : (
                <button
                  type="button"
                  disabled={removing}
                  className="w-fit text-xs text-muted-foreground underline underline-offset-4"
                  onClick={() => setConfirmingPaperRemoval(true)}
                >
                  Entered by mistake? Remove paper waiver record
                </button>
              ))}
            {person.waiverSignedOn && (
              <span className="text-sm text-muted-foreground">
                Signed in the portal {person.waiverSignedOn}
              </span>
            )}
          </>
        ) : person.waiverSignedOn ? (
          <span className="text-sm text-muted-foreground">
            Waiver signed {person.waiverSignedOn}
          </span>
        ) : person.imported && !person.noWaiverRecord ? (
          // Historical attendance from the import: no waiver was ever
          // implied, so it's noted rather than flagged red.
          <span className="text-sm text-muted-foreground">
            Imported from past attendance records · no waiver on record
          </span>
        ) : (
          <>
            <span className="w-fit rounded bg-red-600 px-2 py-0.5 text-xs font-bold tracking-wide text-white">
              WAIVER NOT SIGNED
            </span>
            {person.noWaiverRecord && (
              <>
                <span className="w-fit text-sm font-medium text-amber-700 dark:text-amber-400">
                  No waiver on file — attendance recorded after the event
                </span>
                <span className="text-xs text-muted-foreground">
                  Recorded by {person.noWaiverRecord.recordedBy} · {person.noWaiverRecord.recordedLabel}
                </span>
              </>
            )}
            {person.paperWaiverRemoved && (
              <span className="text-xs text-muted-foreground">
                Paper waiver record removed by {person.paperWaiverRemoved.removedBy} ·{" "}
                {person.paperWaiverRemoved.removedLabel}
              </span>
            )}
          </>
        )}
        {health}
        <SectionAnswers
          sections={answerSections}
          profileFields={person.profileFields}
          dietaryNote={person.dietaryNotes}
          collectsDietary={collectsDietary}
        />
        <CheckInTime at={person.checkedInAt} timing={timing} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={removing || confirming}
          onClick={() => onRemove(person)}
        >
          {confirming ? "Confirm below" : removing ? "Removing..." : "Remove"}
        </Button>
        <button
          type="button"
          onClick={() => onToggleCheckIn(person)}
          className={cn(
            "flex h-11 min-w-32 shrink-0 items-center justify-center rounded-md px-4 text-sm font-semibold transition-colors",
            person.checkedInAt
              ? "bg-green-600 text-white hover:bg-green-700"
              : "border border-input bg-background hover:bg-accent",
          )}
        >
          {person.checkedInAt ? "✓ Checked in" : "Check in"}
        </button>
      </div>
    </li>
  );
}

function VolunteerRosterRow({
  person,
  timing,
  editDetails,
  unregistered,
  answerSections,
  onToggleCheckIn,
  health,
  practicalCheck,
}: {
  person: VolunteerRosterPerson;
  timing: EventTiming;
  /** The "Edit details" control. */
  editDetails?: React.ReactNode;
  /** Hasn't completed volunteer registration (this year's volunteer waiver
   * is signed there). */
  unregistered: boolean;
  /** The event's sections to show answers for (see rosterAnswerSections). */
  answerSections: RegistrationSection[];
  onToggleCheckIn: (person: VolunteerRosterPerson) => void;
  health: React.ReactNode;
  /** Set only for an instructor shift where the viewer can see checks. */
  practicalCheck: { latest: LatestPracticalCheck | null } | null;
}) {
  const contact = [person.phone, person.email].filter(Boolean).join(" · ");
  const emergency = [person.emergencyContact, person.emergencyPhone].filter(Boolean).join(" · ");

  return (
    <li className="flex flex-col gap-1 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
        <span className="font-medium">
          {personDisplayName(person)} · {person.role}
          {person.imported && (
            <span className="ml-2 inline-flex rounded border px-1.5 py-0.5 align-middle text-xs font-medium text-muted-foreground">
              Imported
            </span>
          )}
        </span>
        {unregistered && (
          <span className="w-fit text-sm font-medium text-amber-700 dark:text-amber-400">
            Not registered by the shift&apos;s date — hadn&apos;t completed volunteer registration or signed
            this year&apos;s volunteer waiver by then
          </span>
        )}
        <span className="text-sm text-muted-foreground">{person.shiftLabel}</span>
        <span className="text-sm text-muted-foreground">{contact || "—"}</span>
        {editDetails}
        <span className="text-sm text-muted-foreground">Emergency: {emergency || "—"}</span>
        {person.emergencySecondary && (
          <span className="text-sm text-muted-foreground">Second contact: {person.emergencySecondary}</span>
        )}
        <SectionAnswers
          sections={answerSections}
          profileFields={person.profileFields}
          dietaryNote={
            answerSections.some((section) => section.id === "dietary")
              ? person.profileFields.dietary_notes || null
              : null
          }
          collectsDietary={answerSections.some((section) => section.id === "dietary")}
        />
        {person.notes && (
          <span className="whitespace-pre-line text-sm text-muted-foreground">Notes: {person.notes}</span>
        )}
        {practicalCheck && (
          <Link
            href={`/protected/admin/practical-checks/${person.userId}`}
            className={cn(
              "w-fit text-sm underline underline-offset-4",
              practicalCheck.latest?.outcome === "passed" ? "text-muted-foreground" : "font-medium text-amber-700 dark:text-amber-400",
            )}
          >
            Practical check: {practicalCheckSummary(practicalCheck.latest)}
          </Link>
        )}
        {health}
        <CheckInTime at={person.checkedInAt} timing={{ startsAt: person.shiftStart, endsAt: person.shiftEnd, timeZone: timing.timeZone }} />
      </div>
      <button
        type="button"
        onClick={() => onToggleCheckIn(person)}
        className={cn(
          "flex h-11 min-w-32 shrink-0 items-center justify-center rounded-md px-4 text-sm font-semibold transition-colors",
          person.checkedInAt
            ? "bg-green-600 text-white hover:bg-green-700"
            : "border border-input bg-background hover:bg-accent",
        )}
      >
        {person.checkedInAt ? "✓ Checked in" : "Check in"}
      </button>
    </li>
  );
}

/**
 * "Edit details" on a roster row: a quiet link that opens the person's name
 * and phone for a quick fix at check-in (a misspelling, a wrong digit), saved
 * to their profile. Name and phone only — everything else stays theirs to
 * change. For whoever manages the event, its own lead included; the action
 * checks the same (updateRosterPersonDetailsAction).
 */
function EditDetails({
  eventId,
  person,
  onSaved,
}: {
  eventId: number;
  person: { userId: string; firstName: string; lastName: string; phone: string };
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = (field: string) => `edit_details_${person.userId}_${field}`;

  if (!open) {
    return (
      <button
        type="button"
        className="w-fit text-xs text-muted-foreground underline underline-offset-4"
        onClick={() => {
          setFirstName(person.firstName);
          setLastName(person.lastName);
          setPhone(person.phone);
          setError(null);
          setOpen(true);
        }}
      >
        Edit details
      </button>
    );
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await updateRosterPersonDetailsAction({
        eventId,
        userId: person.userId,
        firstName,
        lastName,
        phone,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <RevealPanel aria-label="Edit details" className="my-1 rounded-md border p-3">
      <form onSubmit={save} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1">
            <Label htmlFor={id("first")} className="text-xs">First name</Label>
            <Input id={id("first")} required autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={id("last")} className="text-xs">Last name</Label>
            <Input id={id("last")} required value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={id("phone")} className="text-xs">Phone</Label>
          <Input
            id={id("phone")}
            type="tel"
            inputMode="numeric"
            maxLength={14}
            placeholder="(303) 555-0100"
            value={phone}
            onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Changes their profile, so it shows this way on every roster.
        </p>
        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </RevealPanel>
  );
}

/**
 * When a check-in was entered. checked_in_at is the moment the button was
 * tapped (or the walk-up added), not the event's date, so a lead catching up
 * from the car park or the next morning shows as exactly that: marked "after
 * the event" once it's past the event's end — or, for an event with no end
 * time, on a later day than it started (isAfterEvent). A volunteer row
 * passes its shift's end as endsAt, so a shift that ended before the event
 * did is measured against the shift.
 */
function CheckInTime({ at, timing }: { at: string | null; timing: EventTiming }) {
  if (!at) return null;
  const afterEvent = isAfterEvent(at, timing);

  return (
    <span className="text-xs text-muted-foreground">
      Checked in {formatEventInstant(at, timing.timeZone)}
      {afterEvent && <span className="font-medium text-amber-600"> · after the event</span>}
    </span>
  );
}

/** One person's registration-section answers, identical for participant and
 * volunteer rows: dietary via DietaryLine (participants' comes from their RSVP
 * copy, volunteers' from the profile), then every other section the event
 * collects (sizing, …). */
function SectionAnswers({
  sections,
  profileFields,
  dietaryNote,
  collectsDietary,
}: {
  sections: RegistrationSection[];
  profileFields: Record<string, string>;
  dietaryNote: string | null;
  collectsDietary: boolean;
}) {
  return (
    <>
      <DietaryLine note={dietaryNote} collected={collectsDietary} />
      {sections
        .filter((section) => section.id !== "dietary")
        .map((section) => (
          <SectionAnswerLine
            key={section.id}
            title={section.title}
            answer={rosterSectionAnswer(section, profileFields)}
          />
        ))}
    </>
  );
}

/** A registration section's answer on a roster row, or a clear marker when
 * they haven't given one — same treatment as an unanswered dietary question. */
function SectionAnswerLine({ title, answer }: { title: string; answer: string | null }) {
  if (answer != null) {
    return (
      <span className="text-sm text-muted-foreground">
        {title}: {answer}
      </span>
    );
  }
  return (
    <span className="w-fit rounded bg-amber-500 px-2 py-0.5 text-xs font-bold tracking-wide text-black">
      {title.toUpperCase()}: NOT ANSWERED
    </span>
  );
}

/** One person's dietary answer: the restrictions, "No restrictions", or — when
 * the event collects it and they haven't answered — a clear marker. */
function DietaryLine({ note, collected }: { note: string | null; collected: boolean }) {
  const display = dietaryDisplay(note);
  if (display.kind === "restrictions") {
    return <span className="text-sm text-muted-foreground">Dietary: {display.text}</span>;
  }
  if (!collected) return null;
  if (display.kind === "none") {
    return <span className="text-sm text-muted-foreground">Dietary: No restrictions</span>;
  }
  return (
    <span className="w-fit rounded bg-amber-500 px-2 py-0.5 text-xs font-bold tracking-wide text-black">
      DIETARY NOT ANSWERED
    </span>
  );
}
