"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  updateEventAction,
  type EventEditInput,
  type WaiverChangeImpact,
} from "@/lib/actions/admin-event";
import { ChapterField } from "@/components/admin/fields/chapter-field";
import { DateTimeFields } from "@/components/admin/fields/datetime-fields";
import { LeadContactFields } from "@/components/admin/fields/lead-contact-fields";
import { LocationFields } from "@/components/admin/fields/location-fields";
import { RegistrationSectionsFields } from "@/components/admin/fields/registration-sections-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function EventEditForm({
  eventId,
  initial,
  isCancelled,
  legacyLocation,
  waiverLabel,
}: {
  eventId: number;
  initial: EventEditInput;
  isCancelled: boolean;
  /** Free-text location of an event that predates the structured fields. */
  legacyLocation: string | null;
  /** "Colorado" / "Georgia" — always derived from the chapter; every event requires it. */
  waiverLabel: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState<EventEditInput>(initial);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [notifyPrompt, setNotifyPrompt] = useState<{ confirmedCount: number } | null>(null);
  // A chapter change that swaps the event to the other state's waiver needs an
  // explicit OK (the server tells us when, and how many people it affects).
  const [waiverPrompt, setWaiverPrompt] = useState<WaiverChangeImpact | null>(null);
  const [waiverConfirmed, setWaiverConfirmed] = useState(false);

  const updateField =
    (field: keyof Omit<EventEditInput, "registrationSections">) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const setField = (field: keyof Omit<EventEditInput, "registrationSections">) => (value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const toggleSection = (sectionId: string, checked: boolean) =>
    setForm((prev) => ({
      ...prev,
      registrationSections: checked
        ? [...prev.registrationSections, sectionId]
        : prev.registrationSections.filter((id) => id !== sectionId),
    }));

  const changeChapter = (value: string) => {
    setForm((prev) => ({ ...prev, chapter: value }));
    // Any earlier confirmation was for a different chapter.
    setWaiverConfirmed(false);
    setWaiverPrompt(null);
    setNotifyPrompt(null);
  };

  const save = async (notifyAttendees: boolean | null, waiverOk = waiverConfirmed) => {
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
    const result = await updateEventAction(eventId, form, notifyAttendees, waiverOk);

    setIsSaving(false);

    if (!result.ok) {
      setError(result.error);
      setNotifyPrompt(null);
      setWaiverPrompt(null);
      return;
    }
    if ("needsWaiverConfirm" in result) {
      setNotifyPrompt(null);
      setWaiverPrompt(result);
      return;
    }
    setWaiverPrompt(null);
    if (result.needsNotifyDecision) {
      setNotifyPrompt({ confirmedCount: result.confirmedCount });
      return;
    }

    setNotifyPrompt(null);
    setSuccess(true);
    setTimeout(() => router.push(`/protected/admin/events/${eventId}`), 900);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await save(null);
  };

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
            <ChapterField idPrefix="edit" value={form.chapter} onChange={changeChapter} />
            <div className="grid gap-2">
              <Label htmlFor="edit_name">Title</Label>
              <Input id="edit_name" required value={form.name} onChange={updateField("name")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_description">Description</Label>
              <Textarea
                id="edit_description"
                value={form.description}
                onChange={updateField("description")}
              />
            </div>
            <LocationFields
              idPrefix="edit"
              value={form}
              onChange={(field, value) => setField(field)(value)}
              required={false}
              legacyLocation={legacyLocation}
            />
            <div className="grid gap-2">
              <Label htmlFor="edit_capacity">Capacity</Label>
              <Input
                id="edit_capacity"
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="Leave blank for unlimited"
                value={form.capacity}
                onChange={updateField("capacity")}
              />
            </div>

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

            <LeadContactFields
              idPrefix="edit"
              name={form.leadName}
              phone={form.leadPhone}
              email={form.leadEmail}
              onChangeName={setField("leadName")}
              onChangePhone={setField("leadPhone")}
              onChangeEmail={setField("leadEmail")}
            />

            <div className="grid gap-2">
              <Label htmlFor="edit_custom_note">Custom email note</Label>
              <Textarea
                id="edit_custom_note"
                placeholder="Shown in the RSVP confirmation email, if set"
                value={form.customEmailNote}
                onChange={updateField("customEmailNote")}
              />
            </div>

            <RegistrationSectionsFields
              idPrefix="edit"
              selected={form.registrationSections}
              onToggle={toggleSection}
            />

            <p className="text-sm text-muted-foreground">
              Waiver: {waiverLabel ?? "not set (this chapter has no waiver state)"}
            </p>

            {waiverPrompt && (
              <div
                role="alertdialog"
                className="flex flex-col gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3"
              >
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  This moves the event from {waiverPrompt.oldStateName} to{" "}
                  {waiverPrompt.newStateName}, so a different waiver applies.
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  <strong>{waiverPrompt.signedOldCount}</strong> of the{" "}
                  <strong>{waiverPrompt.registeredCount}</strong> registered{" "}
                  {waiverPrompt.registeredCount === 1 ? "person" : "people"} signed the{" "}
                  {waiverPrompt.oldStateName} waiver and will be asked to sign the{" "}
                  {waiverPrompt.newStateName} waiver before the event. Until they do, they&apos;ll
                  show as NOT SIGNED on the roster.
                  {waiverPrompt.alreadySignedNewCount > 0 &&
                    ` (${waiverPrompt.alreadySignedNewCount} already signed it and won't be asked again.)`}
                </p>
                {waiverPrompt.newWaiverMissing && (
                  <p className="text-sm font-medium text-red-600">
                    No {waiverPrompt.newStateName} waiver has been published for this event&apos;s
                    year yet — add one under Admin → Waivers, or nobody will be able to sign.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    disabled={isSaving}
                    onClick={() => {
                      setWaiverConfirmed(true);
                      setWaiverPrompt(null);
                      void save(null, true);
                    }}
                  >
                    {isSaving ? "Saving..." : "Yes, change the chapter"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSaving}
                    onClick={() => setWaiverPrompt(null)}
                  >
                    Cancel
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

            {error && <p className="text-sm text-red-500">{error}</p>}
            {success && <p className="text-sm text-green-600">Saved.</p>}
          </CardContent>
          <CardFooter className="flex gap-2">
            {!notifyPrompt && !waiverPrompt && (
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
