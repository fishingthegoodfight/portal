"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DIETARY_NONE,
  isSectionComplete,
  sectionsForEvent,
  type RegistrationField,
  type RegistrationSection,
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
}: {
  userId: string;
  event: EventSummary;
  profile: ProfileSummary;
  /** Every registration field's current profile value, keyed by column. */
  profileFields: Record<string, string>;
  initialRsvp: InitialRsvp;
}) {
  const router = useRouter();
  // Seeded from the profile so a partially-complete section (e.g. a name but
  // no phone) doesn't make the user retype what's already on file.
  const [fieldValues, setFieldValues] =
    useState<Record<string, string>>(profileFields);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSections = sectionsForEvent(event.registration_sections);

  const status = initialRsvp?.status ?? null;
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

  const updateField = (key: string, value: string) =>
    setFieldValues((prev) => ({ ...prev, [key]: value }));

  const incompleteRequiredSection = activeSections.find((section) => {
    if (isSectionComplete(section, fieldValues)) return false;
    return section.fields.some(
      (field) => field.required && !(fieldValues[field.key] ?? "").trim(),
    );
  });
  const hasMissingRequired = Boolean(incompleteRequiredSection);

  const editProfileHref = `/protected/profile?return_to=${encodeURIComponent(
    `/protected/events/${event.id}/rsvp`,
  )}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      const profileUpdates: Record<string, string> = {};
      for (const section of activeSections) {
        if (isSectionComplete(section, profileFields)) continue;
        for (const field of section.fields) {
          const value = (fieldValues[field.key] ?? "").trim();
          if (value) profileUpdates[field.key] = value;
        }
      }
      if (Object.keys(profileUpdates).length > 0) {
        const { error: profileError } = await supabase
          .from("profiles")
          .update(profileUpdates)
          .eq("id", userId);
        if (profileError) throw profileError;
      }

      const effectiveValues = { ...fieldValues, ...profileUpdates };
      const dietaryActive = activeSections.some((s) => s.id === "dietary");
      // The rsvp row's dietary_notes is free text for organizers — an explicit
      // "No" (the DIETARY_NONE sentinel we keep on the profile) is just absence
      // of notes here.
      const dietaryNotes = effectiveValues.dietary_notes;

      const { data, error } = await supabase.rpc("rsvp_to_event", {
        p_event_id: event.id,
        p_dietary:
          dietaryActive && dietaryNotes && dietaryNotes !== DIETARY_NONE
            ? dietaryNotes
            : null,
      });
      if (error) throw error;

      const rsvpStatus = typeof data === "string" && data ? data : "confirmed";
      const params = new URLSearchParams({
        rsvp: rsvpStatus === "waitlisted" ? "waitlisted" : "confirmed",
        event: event.name,
      });
      router.push(`/protected/events?${params.toString()}`);
    } catch (err: unknown) {
      console.error("RSVP failed:", err);
      setError(extractErrorMessage(err));
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setIsCancelling(true);
    setError(null);
    const supabase = createClient();

    try {
      const { error } = await supabase.rpc("cancel_rsvp", {
        p_event_id: event.id,
      });
      if (error) throw error;

      const params = new URLSearchParams({
        rsvp: "cancelled",
        event: event.name,
      });
      router.push(`/protected/events?${params.toString()}`);
    } catch (err: unknown) {
      console.error("Cancel RSVP failed:", err);
      setError(extractErrorMessage(err));
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
            {activeSections.map((section) => (
              <RegistrationSectionField
                key={section.id}
                section={section}
                profileFields={profileFields}
                fieldValues={fieldValues}
                onChange={updateField}
                editProfileHref={editProfileHref}
              />
            ))}
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
            {error && <p className="text-sm text-red-500">{error}</p>}
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button
              type="submit"
              disabled={isSubmitting || hasMissingRequired}
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

function RegistrationSectionField({
  section,
  profileFields,
  fieldValues,
  onChange,
  editProfileHref,
}: {
  section: RegistrationSection;
  profileFields: Record<string, string>;
  fieldValues: Record<string, string>;
  onChange: (key: string, value: string) => void;
  editProfileHref: string;
}) {
  // "On file" is based on the profile as loaded, not live edits — otherwise
  // finishing the last field of a section would make it flip to the
  // read-only summary mid-fill.
  const complete = isSectionComplete(section, profileFields);
  const hasRequiredField = section.fields.some((field) => field.required);

  return (
    <div className="grid gap-1 rounded-md border p-3">
      <span className="text-sm font-medium">{section.title}</span>
      {complete ? (
        <span className="text-sm text-muted-foreground">
          On file: {section.summary(profileFields)}.{" "}
          <Link
            href={editProfileHref}
            className="underline underline-offset-4"
          >
            Edit on profile
          </Link>
        </span>
      ) : (
        <>
          {hasRequiredField && (
            <span className="text-sm text-amber-600 mb-1">
              Required to RSVP — none on file yet.
            </span>
          )}
          <div
            className={
              section.fields.length > 1
                ? "grid grid-cols-2 gap-4"
                : "grid gap-2"
            }
          >
            {section.fields.map((field) =>
              field.type === "yesno" ? (
                <YesNoNotesField
                  key={field.key}
                  field={field}
                  value={fieldValues[field.key] ?? ""}
                  onChange={onChange}
                />
              ) : (
                <div key={field.key} className="grid gap-2">
                  <Label htmlFor={field.key}>{field.label}</Label>
                  {field.type === "textarea" ? (
                    <Textarea
                      id={field.key}
                      placeholder={field.placeholder}
                      required={field.required}
                      value={fieldValues[field.key] ?? ""}
                      onChange={(e) => onChange(field.key, e.target.value)}
                    />
                  ) : (
                    <Input
                      id={field.key}
                      type={field.type === "tel" ? "tel" : "text"}
                      inputMode={field.type === "tel" ? "numeric" : undefined}
                      placeholder={field.placeholder}
                      maxLength={field.type === "tel" ? 14 : undefined}
                      required={field.required}
                      value={fieldValues[field.key] ?? ""}
                      onChange={(e) =>
                        onChange(
                          field.key,
                          field.format
                            ? field.format(e.target.value)
                            : e.target.value,
                        )
                      }
                    />
                  )}
                </div>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A "Yes / No" radio backed by a single free-text column: "No" stores the
 * DIETARY_NONE sentinel, "Yes" reveals a required notes box whose text is the
 * stored value. An empty stored value means "not answered yet", so the RSVP
 * submit gate (which requires this field) stays blocked until a choice is made
 * — and until notes are entered when the choice is "Yes".
 */
function YesNoNotesField({
  field,
  value,
  onChange,
}: {
  field: RegistrationField;
  value: string;
  onChange: (key: string, value: string) => void;
}) {
  const trimmed = value.trim();
  const [choice, setChoice] = useState<"yes" | "no" | "">(
    trimmed === "" ? "" : trimmed === DIETARY_NONE ? "no" : "yes",
  );

  const pick = (next: "yes" | "no") => {
    setChoice(next);
    // "Yes" clears the column back to empty so the notes box starts blank and
    // the submit gate holds until something is typed.
    onChange(field.key, next === "no" ? DIETARY_NONE : "");
  };

  return (
    <div className="grid gap-2">
      <div className="flex gap-6 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={field.key}
            checked={choice === "yes"}
            onChange={() => pick("yes")}
          />
          Yes
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={field.key}
            checked={choice === "no"}
            onChange={() => pick("no")}
          />
          No
        </label>
      </div>
      {choice === "yes" && (
        <div className="grid gap-2">
          <Label htmlFor={field.key}>{field.label}</Label>
          <Textarea
            id={field.key}
            placeholder={field.placeholder}
            required
            value={value === DIETARY_NONE ? "" : value}
            onChange={(e) => onChange(field.key, e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
