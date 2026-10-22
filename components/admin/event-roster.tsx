"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { removePaperWaiverAction } from "@/lib/actions/admin-walkup";
import { updateRosterPersonDetailsAction } from "@/lib/actions/roster-person";
import { adminOfferSpotAction, adminRemoveRsvpAction } from "@/lib/actions/admin-waitlist";
import { CancelEventDialog } from "@/components/admin/cancel-event-dialog";
import { RestoreEventDialog } from "@/components/admin/restore-event-dialog";
import { SaveAsTemplateButton } from "@/components/admin/save-as-template-button";
import { RosterEmailButton } from "@/components/admin/roster-email-button";
import { PhoneTools } from "@/components/phone-tools";
import { logRosterTextAction } from "@/lib/actions/texting";
import { ShareEventCard } from "@/components/admin/share-event-card";
import { EventCard, type EventCardEvent } from "@/components/event-card";
import { Button } from "@/components/ui/button";
import { RevealPanel } from "@/components/reveal-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPhoneNumber } from "@/lib/phone";
import { dietaryDisplay, rosterAnswerSections, rosterSectionAnswer, type RegistrationSection } from "@/lib/registration-sections";
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
import { RosterAddVolunteerDialog } from "@/components/admin/roster-add-volunteer-dialog";
import { RosterWalkupDialog } from "@/components/admin/roster-walkup-dialog";
import { RosterHealthLine, type RosterHealth } from "@/components/admin/roster-health";
import { practicalCheckSummary, type PracticalCheck } from "@/lib/practical-checks";
import type { Chapter } from "@/lib/chapters";
import { personDisplayName } from "@/lib/person-name";
import { isAfterEvent, type EventTiming } from "@/lib/event-timing";
import { formatEventInstant } from "@/lib/format-date";

type LatestPracticalCheck = Pick<PracticalCheck, "outcome" | "checked_on" | "assessor_name">;

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

  const [showAddVolunteerForm, setShowAddVolunteerForm] = useState(false);
  // The event's sections whose answers the volunteer rows show — volunteers
  // answer the same ones participants do when they sign up.
  const answerSections = useMemo(
    () => rosterAnswerSections(registrationSectionIds),
    [registrationSectionIds],
  );


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
            <Button className="h-11 sm:px-6" onClick={() => setShowWalkupForm(true)}>
              Add walk-up
            </Button>
            {volunteerRoles.length > 0 && (
              <Button className="h-11 sm:px-6" variant="outline" onClick={() => setShowAddVolunteerForm(true)}>
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
          <RosterEmailButton
            eventId={eventId}
            chapter={eventCard.chapter}
            timing={timing}
            roster={roster}
            volunteerRoster={volunteerRoster}
          />
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
                    eventId={eventId}
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
                    eventId={eventId}
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
                    eventId={eventId}
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
        <RosterAddVolunteerDialog
          eventId={eventId}
          timing={timing}
          volunteerRoles={volunteerRoles}
          onClose={() => setShowAddVolunteerForm(false)}
        />
      )}
      {showWalkupForm && (
        <RosterWalkupDialog
          eventId={eventId}
          registrationSectionIds={registrationSectionIds}
          chapters={chapters}
          onClose={() => setShowWalkupForm(false)}
        />
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
  eventId,
  person,
  canOffer,
  busy,
  onOffer,
  onRemove,
  confirming,
}: {
  /** For Log text (log_roster_text). */
  eventId: number;
  person: WaitlistPerson;
  canOffer: boolean;
  busy: boolean;
  onOffer: (person: WaitlistPerson) => void;
  onRemove: (person: WaitlistPerson) => void;
  /** Their "Remove?" confirmation is open, right below this row. */
  confirming: boolean;
}) {
  const canOfferThis = person.status !== "offered";

  return (
    <li className="flex flex-col gap-3 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
        <span className="font-medium">
          {person.position != null ? `#${person.position} ` : ""}
          {personDisplayName(person)}
        </span>
        <ContactLine eventId={eventId} person={person} />
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
  eventId,
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
  /** For Log text (log_roster_text). */
  eventId: number;
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
        <ContactLine eventId={eventId} person={person} />
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
  eventId,
  person,
  timing,
  editDetails,
  unregistered,
  answerSections,
  onToggleCheckIn,
  health,
  practicalCheck,
}: {
  /** For Log text (log_roster_text). */
  eventId: number;
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
        <ContactLine eventId={eventId} person={person} />
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

/** A roster person's phone (call, Text, Copy, Log text) and email. */
function ContactLine({
  eventId,
  person,
}: {
  eventId: number;
  person: { userId: string; phone: string; email: string; firstName: string; lastName: string };
}) {
  const phone = person.phone ? formatPhoneNumber(person.phone) : "";
  if (!phone && !person.email) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
      {phone && (
        <PhoneTools
          phone={phone}
          name={personDisplayName(person)}
          onLogText={() => logRosterTextAction(eventId, person.userId)}
        />
      )}
      {phone && person.email && <span aria-hidden>·</span>}
      {person.email}
    </span>
  );
}
