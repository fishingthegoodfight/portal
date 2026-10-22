"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { adminAddVolunteerSignupAction } from "@/lib/actions/admin-volunteer-signup";
import { EventPersonSearch } from "@/components/admin/event-person-search";
import { Button } from "@/components/ui/button";
import { RevealPanel } from "@/components/reveal-panel";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import type { VolunteerRoleSummary } from "@/lib/admin/roster";
import type { EventTiming } from "@/lib/event-timing";

/**
 * The roster's "Add volunteer" dialog: put someone on one of the event's
 * volunteer roles (adminAddVolunteerSignupAction), confirming each override
 * it raises (not approved for the role, already RSVP'd to attend, shift
 * full, no practical check, not registered) before adding them. Mounted
 * fresh each time it opens.
 */
export function RosterAddVolunteerDialog({
  eventId,
  timing,
  volunteerRoles,
  onClose,
}: {
  eventId: number;
  timing: EventTiming;
  /** Every volunteer role at the event; the first is picked to start. */
  volunteerRoles: VolunteerRoleSummary[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [addVolunteerEmail, setAddVolunteerEmail] = useState("");
  // Whether the event had started when Add volunteer was opened: it may be
  // recording a shift after the fact (adminAddVolunteerSignupAction marks an
  // ended shift as served and sends no emails), and the form says so.
  const [addVolunteerEventStarted] = useState(() => new Date(timing.startsAt).getTime() <= Date.now());
  const [addVolunteerOpportunityId, setAddVolunteerOpportunityId] = useState(
    volunteerRoles[0] ? String(volunteerRoles[0].opportunityId) : "",
  );
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
    onClose();
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

    onClose();
    router.refresh();
  };

  return (
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
  );
}
