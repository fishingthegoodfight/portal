"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  updateEventAction,
  type EditWarning,
  type EventEditInput,
} from "@/lib/actions/admin-event";
import { ChapterField } from "@/components/admin/fields/chapter-field";
import { DateTimeFields } from "@/components/admin/fields/datetime-fields";
import {
  CapacityField,
  CustomEmailNoteField,
  DescriptionField,
  EventTypeField,
  TitleField,
} from "@/components/admin/fields/event-text-fields";
import { LeadContactFields } from "@/components/admin/fields/lead-contact-fields";
import { LocationFields } from "@/components/admin/fields/location-fields";
import { RegistrationSectionsFields } from "@/components/admin/fields/registration-sections-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

type StringField = Exclude<keyof EventEditInput, "registrationSections">;

export function EventEditForm({
  eventId,
  initial,
  isCancelled,
  legacyLocation,
  waiverLabel,
  isPartOfSeries,
}: {
  eventId: number;
  initial: EventEditInput;
  isCancelled: boolean;
  /** Free-text location of an event that predates the structured fields. */
  legacyLocation: string | null;
  /** "Colorado" / "Georgia" — always derived from the chapter; every event requires it. */
  waiverLabel: string | null;
  /** The event was created as one of a repeating series. */
  isPartOfSeries: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<EventEditInput>(initial);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [notifyPrompt, setNotifyPrompt] = useState<{ confirmedCount: number } | null>(null);
  // Things the server wants confirmed before it saves (capacity, waiver, past
  // date, registration sections). They describe the form as it was when asked,
  // so any further edit clears them and the admin is asked again on save.
  const [warnings, setWarnings] = useState<EditWarning[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const edit = (updater: (prev: EventEditInput) => EventEditInput) => {
    setForm(updater);
    setWarnings(null);
    setConfirmed(false);
    setNotifyPrompt(null);
  };

  const setField = (field: StringField) => (value: string) =>
    edit((prev) => ({ ...prev, [field]: value }));

  const toggleSection = (sectionId: string, checked: boolean) =>
    edit((prev) => ({
      ...prev,
      registrationSections: checked
        ? [...prev.registrationSections, sectionId]
        : prev.registrationSections.filter((id) => id !== sectionId),
    }));

  const save = async (notifyAttendees: boolean | null, alreadyConfirmed = confirmed) => {
    setError(null);

    // Same-day string comparison — a quick client-side check to catch the
    // common typo before a round trip; updateEventAction re-validates this
    // for real (comparing actual UTC instants) since it's the source of
    // truth, not this shortcut.
    if (form.endTime && form.endTime <= form.time) {
      setError("End time must be after the start time");
      return;
    }

    setIsSaving(true);
    try {
      const result = await updateEventAction(eventId, form, notifyAttendees, alreadyConfirmed);

      if (!result.ok) {
        setError(result.error);
        setNotifyPrompt(null);
        setWarnings(null);
        return;
      }
      if ("needsConfirm" in result) {
        setNotifyPrompt(null);
        setWarnings(result.warnings);
        return;
      }
      setWarnings(null);
      if (result.needsNotifyDecision) {
        setNotifyPrompt({ confirmedCount: result.confirmedCount });
        return;
      }

      setNotifyPrompt(null);
      setSuccess(true);
      setTimeout(() => router.push(`/protected/admin/events/${eventId}`), 900);
    } catch (err) {
      console.error("Save event failed:", err);
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await save(null);
  };

  const strong = warnings?.some((w) => w.severity === "strong") ?? false;

  return (
    <div className="flex flex-col gap-4">
      {isCancelled && (
        <p className="text-sm rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
          This event is cancelled. Editing it won&apos;t reopen it.
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Event details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {isPartOfSeries && (
              <p className="text-sm text-muted-foreground">
                This event is part of a repeating series. Changes here apply to this occurrence
                only.
              </p>
            )}
            <div className="grid grid-cols-2 gap-4">
              <ChapterField idPrefix="edit" value={form.chapter} onChange={setField("chapter")} />
              <EventTypeField
                idPrefix="edit"
                value={form.eventType}
                onChange={setField("eventType")}
              />
            </div>
            <TitleField idPrefix="edit" value={form.name} onChange={setField("name")} />

            <DateTimeFields
              idPrefix="edit"
              date={form.date}
              time={form.time}
              endTime={form.endTime}
              timezone={form.timezone}
              onChangeDate={setField("date")}
              onChangeTime={setField("time")}
              onChangeEndTime={setField("endTime")}
              onChangeTimezone={setField("timezone")}
            />

            <LocationFields
              idPrefix="edit"
              value={form}
              onChange={(field, value) => setField(field)(value)}
              required={false}
              legacyLocation={legacyLocation}
            />

            <DescriptionField
              idPrefix="edit"
              value={form.description}
              onChange={setField("description")}
            />

            <CapacityField
              idPrefix="edit"
              value={form.capacity}
              onChange={setField("capacity")}
            />

            <LeadContactFields
              idPrefix="edit"
              name={form.leadName}
              phone={form.leadPhone}
              email={form.leadEmail}
              onChangeName={setField("leadName")}
              onChangePhone={setField("leadPhone")}
              onChangeEmail={setField("leadEmail")}
            />

            <CustomEmailNoteField
              idPrefix="edit"
              value={form.customEmailNote}
              onChange={setField("customEmailNote")}
            />

            <RegistrationSectionsFields
              idPrefix="edit"
              selected={form.registrationSections}
              onToggle={toggleSection}
            />

            <p className="text-sm text-muted-foreground">
              Waiver: {waiverLabel ?? "not set (this chapter has no waiver state)"}
            </p>

            {warnings && (
              <div
                role="alertdialog"
                className={
                  strong
                    ? "flex flex-col gap-3 rounded-md border border-red-500/60 bg-red-500/10 p-3"
                    : "flex flex-col gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3"
                }
              >
                <p
                  className={
                    strong
                      ? "text-sm font-semibold text-red-700 dark:text-red-400"
                      : "text-sm font-semibold text-amber-700 dark:text-amber-400"
                  }
                >
                  Please confirm before saving:
                </p>
                <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
                  {warnings.map((warning, i) => (
                    <li
                      key={i}
                      className={
                        warning.severity === "strong"
                          ? "font-medium text-red-700 dark:text-red-400"
                          : "text-amber-700 dark:text-amber-400"
                      }
                    >
                      <WarningText warning={warning} />
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={strong ? "destructive" : "default"}
                    disabled={isSaving}
                    onClick={() => {
                      setConfirmed(true);
                      setWarnings(null);
                      void save(null, true);
                    }}
                  >
                    {isSaving ? "Saving..." : "Yes, save these changes"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSaving}
                    onClick={() => setWarnings(null)}
                  >
                    Go back
                  </Button>
                </div>
              </div>
            )}

            {notifyPrompt && (
              <div className="flex flex-col gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  This changes the date, time, location, or chapter for{" "}
                  <strong>{notifyPrompt.confirmedCount}</strong> confirmed{" "}
                  {notifyPrompt.confirmedCount === 1 ? "attendee" : "attendees"}. Send them an
                  update email with a revised calendar invite?
                </p>
                <div className="flex gap-2">
                  <Button type="button" disabled={isSaving} onClick={() => save(true)}>
                    {isSaving ? "Saving..." : "Yes, notify them"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSaving}
                    onClick={() => save(false)}
                  >
                    No, just save
                  </Button>
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-red-500">
                {error}
              </p>
            )}
            {success && <p className="text-sm text-green-600">Saved.</p>}
          </CardContent>
          <CardFooter className="flex gap-2">
            {!notifyPrompt && !warnings && (
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Saving..." : "Save changes"}
              </Button>
            )}
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function WarningText({ warning }: { warning: EditWarning }) {
  switch (warning.kind) {
    case "waiver":
      return (
        <>
          This moves the event from {warning.oldStateName} to {warning.newStateName}, so a
          different waiver applies. <strong>{warning.signedOldCount}</strong> of the{" "}
          <strong>{warning.registeredCount}</strong> registered{" "}
          {warning.registeredCount === 1 ? "person" : "people"} signed the {warning.oldStateName}{" "}
          waiver and will be asked to sign the {warning.newStateName} waiver before the event;
          until they do, they&apos;ll show as NOT SIGNED on the roster.
          {warning.alreadySignedNewCount > 0 &&
            ` (${warning.alreadySignedNewCount} already signed it and won't be asked again.)`}
          {warning.newWaiverMissing &&
            ` No ${warning.newStateName} waiver is published for this event's year yet — add one under Admin → Waivers, or nobody will be able to sign.`}
        </>
      );
    case "capacity":
      return (
        <>
          Capacity {warning.newCapacity} is below the{" "}
          <strong>{plural(warning.confirmedCount, "person", "people")}</strong> already confirmed
          {warning.overBy > 0 && (
            <>
              {" "}
              (<strong>{warning.overBy}</strong> over). Nobody is removed, but no one new can
              register until enough people cancel.
            </>
          )}
          {warning.overBy === 0 && "."}
          {warning.offersDisplaced > 0 && (
            <>
              {" "}
              <strong>
                {plural(warning.offersDisplaced, "open waitlist offer", "open waitlist offers")}
              </strong>{" "}
              no longer {warning.offersDisplaced === 1 ? "fits" : "fit"} and will be withdrawn now.
              Those people (the latest to join the waitlist) go back on the waitlist in their
              original place and are emailed that their spot is no longer available.
            </>
          )}
        </>
      );
    case "past_date":
      return (
        <>
          The new start is in the past, and{" "}
          <strong>{plural(warning.registeredCount, "person is", "people are")}</strong> registered.
          Reminders and waitlist offers stop once an event has started.
        </>
      );
    case "sections_removed":
      return (
        <>
          Removing <strong>{warning.titles.join(", ")}</strong>: new registrants won&apos;t be
          asked for {warning.titles.length === 1 ? "it" : "them"} any more. Answers people already
          gave stay on their profiles and RSVPs.
        </>
      );
    case "sections_added":
      return (
        <>
          Adding{" "}
          {warning.sections.map((section, i) => (
            <span key={section.title}>
              {i > 0 && ", "}
              <strong>{section.title}</strong> ({section.missingCount} of {warning.registeredCount}{" "}
              registered {warning.registeredCount === 1 ? "person hasn't" : "people haven't"}{" "}
              answered it yet)
            </span>
          ))}
          . They can fill it in with &quot;Update my registration&quot; on the event page.
        </>
      );
  }
}
