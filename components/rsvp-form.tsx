"use client";

import { useState } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
};

type ProfileSummary = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  emergency_contact: string;
  emergency_phone: string;
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
  event,
  profile,
  initialRsvp,
}: {
  event: EventSummary;
  profile: ProfileSummary;
  initialRsvp: InitialRsvp;
}) {
  const [dietaryNotes, setDietaryNotes] = useState(
    initialRsvp?.dietaryNotes ?? "",
  );
  const [status, setStatus] = useState<string | null>(
    initialRsvp?.status ?? null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const hasActiveRsvp = Boolean(status) && status !== "cancelled";
  const spotsLeft =
    event.capacity != null && event.spots_taken != null
      ? event.capacity - event.spots_taken
      : null;
  // Spots-left is as of page load — the capacity-check function is the real
  // gate at submit time; this just avoids inviting a doomed submission.
  const isFull = spotsLeft != null && spotsLeft <= 0 && !hasActiveRsvp;
  const profileIncomplete =
    !profile.first_name || !profile.last_name || !profile.email;
  const emergencyContactMissing =
    !profile.emergency_contact || !profile.emergency_phone;
  const editProfileHref = `/protected/profile?return_to=${encodeURIComponent(
    `/protected/events/${event.id}/rsvp`,
  )}`;

  // After the RPC runs, re-read the row rather than assume what it did —
  // rsvp_to_event may confirm or waitlist, and cancel_rsvp may soft-cancel
  // or delete, so this is the only reliable way to know the resulting state.
  const refreshStatus = async (supabase: ReturnType<typeof createClient>) => {
    const { data } = await supabase
      .from("rsvps")
      .select("status, dietary_notes")
      .eq("event_id", event.id)
      .maybeSingle();
    return data;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (emergencyContactMissing) {
      // Belt-and-suspenders: the submit button is disabled for this case
      // too, but guard here in case the form is ever submitted some other
      // way (e.g. pressing Enter before React re-renders the disabled state).
      setError("Add an emergency contact and phone number before RSVPing.");
      return;
    }
    setIsSubmitting(true);
    const supabase = createClient();

    try {
      const { data, error } = await supabase.rpc("rsvp_to_event", {
        p_event_id: event.id,
        p_dietary: dietaryNotes || null,
      });
      if (error) throw error;

      const refreshed = await refreshStatus(supabase);
      setStatus(refreshed?.status ?? "confirmed");
      if (refreshed?.dietary_notes != null) {
        setDietaryNotes(refreshed.dietary_notes);
      }
      setMessage(typeof data === "string" && data ? data : "RSVP submitted.");
    } catch (err: unknown) {
      console.error("RSVP failed:", err);
      setError(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setIsCancelling(true);
    setError(null);
    setMessage(null);
    const supabase = createClient();

    try {
      const { error } = await supabase.rpc("cancel_rsvp", {
        p_event_id: event.id,
      });
      if (error) throw error;

      const refreshed = await refreshStatus(supabase);
      setStatus(refreshed?.status ?? null);
      setMessage("Your RSVP has been cancelled.");
    } catch (err: unknown) {
      console.error("Cancel RSVP failed:", err);
      setError(extractErrorMessage(err));
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>{event.name}</CardTitle>
              <CardDescription>
                {event.dateRange}
                {event.location ? ` · ${event.location}` : ""}
              </CardDescription>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              {event.chapter && (
                <Badge variant="secondary">{event.chapter}</Badge>
              )}
              {event.event_type && (
                <Badge variant="outline">{event.event_type}</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        {event.description && (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {event.description}
            </p>
          </CardContent>
        )}
      </Card>

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
            <div className="grid gap-1 rounded-md border p-3">
              <span className="text-sm font-medium">Emergency contact</span>
              {profile.emergency_contact || profile.emergency_phone ? (
                <span className="text-sm text-muted-foreground">
                  {profile.emergency_contact || "?"}
                  {profile.emergency_phone
                    ? ` · ${profile.emergency_phone}`
                    : ""}
                </span>
              ) : (
                <span className="text-sm text-amber-600">
                  Required to RSVP — none on file yet.{" "}
                  <Link
                    href={editProfileHref}
                    className="underline underline-offset-4"
                  >
                    Add one in your profile
                  </Link>
                  .
                </span>
              )}
            </div>
            {status && (
              <p className="text-sm">
                Current status: <span className="font-medium">{status}</span>
              </p>
            )}
            {isFull && (
              <p className="text-sm text-amber-600">
                This event shows no spots left as of the last page load — you
                may be waitlisted.
              </p>
            )}
            <div className="grid gap-2">
              <Label htmlFor="dietary_notes">Dietary notes</Label>
              <Textarea
                id="dietary_notes"
                placeholder="Allergies, preferences, etc. (optional)"
                value={dietaryNotes}
                onChange={(e) => setDietaryNotes(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            {message && <p className="text-sm text-green-600">{message}</p>}
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button
              type="submit"
              disabled={isSubmitting || emergencyContactMissing}
            >
              {isSubmitting
                ? "Submitting..."
                : hasActiveRsvp
                  ? "Update RSVP"
                  : "RSVP"}
            </Button>
            {hasActiveRsvp && (
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isCancelling}
              >
                {isCancelling ? "Cancelling..." : "Cancel RSVP"}
              </Button>
            )}
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
