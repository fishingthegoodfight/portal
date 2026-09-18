"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { addWalkupRsvpAction } from "@/lib/actions/admin-walkup";
import { CancelEventDialog } from "@/components/admin/cancel-event-dialog";
import { RestoreEventDialog } from "@/components/admin/restore-event-dialog";
import { EventCard, type EventCardEvent } from "@/components/event-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPhoneNumber } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { RosterPerson } from "@/lib/admin/roster";

type WalkupFormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

const EMPTY_WALKUP_FORM: WalkupFormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
};

export function EventRoster({
  eventId,
  eventCard,
  status,
  cancellationReason,
  initialRoster,
}: {
  eventId: number;
  eventCard: EventCardEvent;
  status: string;
  cancellationReason: string | null;
  initialRoster: RosterPerson[];
}) {
  const router = useRouter();
  const isCancelled = status === "cancelled";

  // Re-synced from the server whenever a fresh load comes in (router.refresh()
  // after adding a walk-up) — initialRoster is a new array each time the
  // server component re-renders, so this only fires on genuinely new data.
  const [roster, setRoster] = useState<RosterPerson[]>(initialRoster);
  useEffect(() => {
    setRoster(initialRoster);
  }, [initialRoster]);

  const [search, setSearch] = useState("");
  const [checkInError, setCheckInError] = useState<string | null>(null);

  const [showWalkupForm, setShowWalkupForm] = useState(false);
  const [walkupForm, setWalkupForm] = useState<WalkupFormState>(EMPTY_WALKUP_FORM);
  const [walkupError, setWalkupError] = useState<string | null>(null);
  const [isSubmittingWalkup, setIsSubmittingWalkup] = useState(false);
  const [capacityConfirmPending, setCapacityConfirmPending] = useState(false);

  const confirmedCount = roster.filter((p) => p.status === "confirmed").length;
  const checkedInCount = roster.filter((p) => p.checkedInAt).length;

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

    const supabase = createClient();
    const { error } = await supabase
      .from("rsvps")
      .update({ checked_in_at: next })
      .eq("id", person.rsvpId);

    if (error) {
      setRoster((prev) =>
        prev.map((p) => (p.rsvpId === person.rsvpId ? { ...p, checkedInAt: previous } : p)),
      );
      setCheckInError(
        `Couldn't update check-in for ${person.firstName} ${person.lastName}: ${error.message}`,
      );
    }
  };

  const openWalkupForm = () => {
    setWalkupForm(EMPTY_WALKUP_FORM);
    setWalkupError(null);
    setCapacityConfirmPending(false);
    setShowWalkupForm(true);
  };

  const closeWalkupForm = () => {
    if (isSubmittingWalkup) return;
    setShowWalkupForm(false);
  };

  const updateWalkupField =
    (field: keyof WalkupFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setWalkupForm((prev) => ({ ...prev, [field]: e.target.value }));

  const updateWalkupPhoneField =
    (field: "phone" | "emergencyContactPhone") => (e: React.ChangeEvent<HTMLInputElement>) =>
      setWalkupForm((prev) => ({ ...prev, [field]: formatPhoneNumber(e.target.value) }));

  const submitWalkup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingWalkup(true);
    setWalkupError(null);

    const result = await addWalkupRsvpAction({
      eventId,
      firstName: walkupForm.firstName,
      lastName: walkupForm.lastName,
      email: walkupForm.email,
      phone: walkupForm.phone,
      emergencyContactName: walkupForm.emergencyContactName,
      emergencyContactPhone: walkupForm.emergencyContactPhone,
      force: capacityConfirmPending,
    });

    setIsSubmittingWalkup(false);

    if (!result.ok) {
      setWalkupError(result.error);
      return;
    }
    if (result.status === "capacity_exceeded") {
      setCapacityConfirmPending(true);
      return;
    }

    setShowWalkupForm(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <EventCard event={eventCard} rsvpStatus={null} />

      {isCancelled && (
        <div className="rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          <p className="font-semibold">This event is cancelled.</p>
          {cancellationReason && <p className="mt-1">Reason: {cancellationReason}</p>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Capacity" value={eventCard.capacity ?? "—"} />
        <StatTile label="Confirmed" value={confirmedCount} />
        <StatTile label="Checked in" value={checkedInCount} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Search by name, email, or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/protected/admin/events/${eventId}/edit`}>Edit event</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/protected/admin/events/${eventId}/print`} target="_blank">
              Print roster
            </Link>
          </Button>
          {!isCancelled && <Button onClick={openWalkupForm}>Add walk-up</Button>}
          {isCancelled ? (
            <RestoreEventDialog
              eventId={eventId}
              eventName={eventCard.name}
              confirmedCount={confirmedCount}
              onRestored={() => router.refresh()}
            />
          ) : (
            <CancelEventDialog
              eventId={eventId}
              eventName={eventCard.name}
              onCancelled={() => router.refresh()}
            />
          )}
        </div>
      </div>

      {checkInError && <p className="text-sm text-red-500">{checkInError}</p>}

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
                <RosterRow key={person.rsvpId} person={person} onToggleCheckIn={toggleCheckIn} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {showWalkupForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-sm">
            <form onSubmit={submitWalkup}>
              <CardHeader>
                <CardTitle>Add walk-up</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="walkup_first_name">First name</Label>
                    <Input
                      id="walkup_first_name"
                      required
                      autoFocus
                      autoComplete="given-name"
                      value={walkupForm.firstName}
                      onChange={updateWalkupField("firstName")}
                    />
                  </div>
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
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="walkup_email">Email</Label>
                  <Input
                    id="walkup_email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    value={walkupForm.email}
                    onChange={updateWalkupField("email")}
                  />
                </div>
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
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="walkup_emergency_name">Emergency contact</Label>
                    <Input
                      id="walkup_emergency_name"
                      required
                      value={walkupForm.emergencyContactName}
                      onChange={updateWalkupField("emergencyContactName")}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="walkup_emergency_phone">Emergency phone</Label>
                    <Input
                      id="walkup_emergency_phone"
                      type="tel"
                      inputMode="numeric"
                      placeholder="(303) 555-0100"
                      maxLength={14}
                      required
                      value={walkupForm.emergencyContactPhone}
                      onChange={updateWalkupPhoneField("emergencyContactPhone")}
                    />
                  </div>
                </div>
                {capacityConfirmPending && (
                  <p className="text-sm text-amber-600">
                    This event is at capacity. Add {walkupForm.firstName || "them"} anyway?
                  </p>
                )}
                {walkupError && <p className="text-sm text-red-500">{walkupError}</p>}
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
                    : capacityConfirmPending
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

function RosterRow({
  person,
  onToggleCheckIn,
}: {
  person: RosterPerson;
  onToggleCheckIn: (person: RosterPerson) => void;
}) {
  const contact = [person.phone, person.email].filter(Boolean).join(" · ");
  const emergency = [person.emergencyContact, person.emergencyPhone].filter(Boolean).join(" · ");

  return (
    <li className="flex flex-col gap-3 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">
          {person.firstName} {person.lastName}
        </span>
        <span className="text-sm text-muted-foreground">{contact || "—"}</span>
        <span className="text-sm text-muted-foreground">Emergency: {emergency || "—"}</span>
        {person.dietaryNotes && (
          <span className="text-sm text-muted-foreground">Dietary: {person.dietaryNotes}</span>
        )}
        {person.status === "waitlisted" && (
          <span className="text-xs font-medium text-amber-600">Waitlisted</span>
        )}
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
