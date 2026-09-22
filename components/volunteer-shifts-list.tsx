"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { cancelVolunteerSignupAction } from "@/lib/actions/volunteer-signup";
import { Button } from "@/components/ui/button";

export type VolunteerShift = {
  opportunityId: number;
  eventId: number;
  eventName: string;
  role: string;
  /** Pre-formatted in the event's own timezone. */
  shiftLabel: string;
};

function ShiftRow({
  shift,
  showCancel,
  onCancel,
  busy,
}: {
  shift: VolunteerShift;
  showCancel: boolean;
  onCancel: (opportunityId: number) => void;
  busy: boolean;
}) {
  return (
    <li className="flex flex-col gap-1 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-0.5">
        <Link
          href={`/protected/events/${shift.eventId}/rsvp`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {shift.eventName}
        </Link>
        <span className="text-sm text-muted-foreground">
          {shift.role} · {shift.shiftLabel}
        </span>
      </div>
      {showCancel && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => onCancel(shift.opportunityId)}
        >
          {busy ? "Cancelling..." : "Cancel"}
        </Button>
      )}
    </li>
  );
}

export function VolunteerShiftsList({
  upcoming,
  past,
}: {
  upcoming: VolunteerShift[];
  past: VolunteerShift[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-red-500">{error}</p>}
      {upcoming.length === 0 ? (
        <p className="text-sm text-muted-foreground">No upcoming shifts.</p>
      ) : (
        <ul>
          {upcoming.map((shift) => (
            <ShiftRow
              key={shift.opportunityId}
              shift={shift}
              showCancel
              onCancel={handleCancel}
              busy={busyId === shift.opportunityId}
            />
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <span className="text-sm font-medium text-muted-foreground">Past shifts</span>
          <ul>
            {past.map((shift) => (
              <ShiftRow
                key={shift.opportunityId}
                shift={shift}
                showCancel={false}
                onCancel={handleCancel}
                busy={false}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
