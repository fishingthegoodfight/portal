"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  updateEventAction,
  type EditWarning,
  type EventEditInput,
} from "@/lib/actions/admin-event";
import { seriesScopeSummaryAction, type ScopeSummary } from "@/lib/actions/admin-event-series";
import type { EditableVolunteerRole } from "@/lib/admin/event-roles";
import type { EditScope } from "@/lib/admin/series";
import { ChapterField } from "@/components/admin/fields/chapter-field";
import { DateTimeFields } from "@/components/admin/fields/datetime-fields";
import {
  CapacityField,
  CustomEmailNoteField,
  DescriptionField,
  EventTypeField,
  OccurrenceNoteField,
  TitleField,
} from "@/components/admin/fields/event-text-fields";
import { LeadContactFields } from "@/components/admin/fields/lead-contact-fields";
import { MarketingBoostField } from "@/components/admin/fields/marketing-boost-field";
import { RequiresHealthHistoryField } from "@/components/admin/fields/requires-health-history-field";
import { LocationFields } from "@/components/admin/fields/location-fields";
import { VirtualEventFields } from "@/components/admin/fields/virtual-event-fields";
import { isVirtualChapter } from "@/lib/chapters";
import { RegistrationSectionsFields } from "@/components/admin/fields/registration-sections-fields";
import {
  VolunteerRoleFields,
  roleTypesForEvent,
  volunteerRoleErrors,
  type VolunteerRoleTypeOption,
} from "@/components/admin/fields/volunteer-role-fields";
import { SeriesScopeChoice } from "@/components/admin/series-scope-choice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RevealPanel } from "@/components/reveal-panel";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { EventTypeOption } from "@/lib/event-types";
import { Label } from "@/components/ui/label";
import { normalizeSlug, slugError } from "@/lib/event-slug";
import { saveVenueFromEventAction } from "@/lib/actions/venues";
import { findVenueByName, venuesForChapter, type Venue } from "@/lib/venues";
import { capacityError } from "@/lib/event-capacity";
import { locationErrors } from "@/lib/event-location";
import type { EventFormField } from "@/lib/event-db-errors";

/** Error field -> the suffix of its input's id (`edit_<suffix>`). */
const FIELD_INPUT_IDS: Partial<Record<EventFormField, string>> = {
  chapter: "chapter",
  event_type: "event_type",
  title: "title",
  slug: "slug",
  date: "date",
  time: "time",
  timezone: "timezone",
  venue: "venue",
  street: "street",
  city: "city",
  state: "state",
  postal_code: "postal_code",
  virtual_link: "virtual_link",
  description: "description",
  occurrence_note: "occurrence_note",
  capacity: "capacity",
  lead: "lead_name",
  custom_note: "custom_note",
  boost: "boost",
};

/** Fields with a problemFor(...) slot in the form below. */
const FIELDS_WITH_SLOTS = new Set<EventFormField>([
  "chapter", "event_type", "template", "title", "slug", "date", "time", "timezone",
  "venue", "street", "city", "state", "postal_code", "virtual_link", "description",
  "occurrence_note", "capacity", "lead", "custom_note", "sections", "roles", "boost",
]);

/** Every rule the database also enforces that can be checked here, so a
 * problem shows next to its field before a round trip — updateEventAction
 * re-checks all of it. First problem wins (one field at a time). */
function fieldProblem(form: EventEditInput): { field: EventFormField; message: string } | null {
  if (!form.name.trim()) return { field: "title", message: "Event title is required" };
  if (form.slug && slugError(normalizeSlug(form.slug))) {
    return { field: "slug", message: slugError(normalizeSlug(form.slug)) as string };
  }
  if (!form.date || !form.time) return { field: "date", message: "Date and start time are required" };
  // Same-day string comparison — updateEventAction re-checks the real instants.
  if (form.endTime && form.endTime <= form.time) {
    return { field: "time", message: "End time must be after the start time" };
  }
  if (!form.timezone) return { field: "timezone", message: "Time zone is required" };
  if (isVirtualChapter(form.chapter)) {
    if (!form.virtualLink.trim()) {
      return { field: "virtual_link", message: "A meeting link is required for a virtual event" };
    }
  } else {
    const problems = locationErrors(form, { allowLegacyEmpty: true });
    if (problems.length > 0) return { field: "venue", message: problems.join("; ") };
  }
  const capacity = capacityError(form.capacity);
  if (capacity) return { field: "capacity", message: capacity };
  return null;
}

type StringField = Exclude<
  keyof EventEditInput,
  "registrationSections" | "volunteerRoles" | "boostTier1" | "requiresHealthHistory"
>;

function emptyRole(): EditableVolunteerRole {
  return {
    id: null,
    removal: null,
    title: "",
    description: "",
    shiftStart: "",
    shiftEnd: "",
    whatToBring: "",
    numberNeeded: "1",
    roleTypeId: "",
  };
}

export function EventEditForm({
  eventId,
  publicUrlBase,
  initial,
  isCancelled,
  legacyLocation,
  waiverLabel,
  seriesId,
  eventTypes,
  roleTypes,
  signedUpByRoleId,
  allowedChapters,
  venues,
}: {
  eventId: number;
  /** "https://…/events/" — shown in front of the slug field. */
  publicUrlBase: string;
  initial: EventEditInput;
  isCancelled: boolean;
  /** Free-text location of an event that predates the structured fields. */
  legacyLocation: string | null;
  /** "Colorado" / "Georgia" — always derived from the chapter; every event requires it. */
  waiverLabel: string | null;
  /** Set when the event was created as one of a repeating series — saving
   * then asks "This event only" vs "This and all future events". */
  seriesId: string | null;
  /** Every event_types row, active and inactive — an already-deactivated
   * type stays selectable so this event's edit form never silently changes it. */
  eventTypes: EventTypeOption[];
  /** Role types offered for a volunteer role (see the edit page loader). */
  roleTypes: VolunteerRoleTypeOption[];
  /** Confirmed signups per existing role id. */
  signedUpByRoleId: Record<number, number>;
  /** Chapters this person may move the event to (manageable_chapters) —
   * the current one always stays. */
  allowedChapters: string[];
  /** Active saved venues, for the venue picker. */
  venues: Venue[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<EventEditInput>(initial);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A problem that belongs to one field — shown under that field instead of
  // down by the Save button.
  const [fieldError, setFieldError] = useState<{ field: EventFormField; message: string } | null>(null);
  const [success, setSuccess] = useState(false);
  const [notifyPrompt, setNotifyPrompt] = useState<{
    confirmedCount: number;
    eventCount: number;
  } | null>(null);
  // Things the server wants confirmed before it saves (capacity, waiver, past
  // date, registration sections). They describe the form as it was when asked,
  // so any further edit clears them and the admin is asked again on save.
  const [warnings, setWarnings] = useState<EditWarning[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  // Series only: the scope question, asked on every save before anything
  // else, with the counts for each choice. `scope` is the answer, kept
  // through the warning/notify follow-ups of the same save.
  const [scopePrompt, setScopePrompt] = useState<ScopeSummary | null>(null);
  const [scope, setScope] = useState<EditScope | null>(null);
  const [applyOccurrenceNote, setApplyOccurrenceNote] = useState(false);
  // The existing role (by index) whose "Remove" is asking to cancel instead.
  const [cancelAsk, setCancelAsk] = useState<number | null>(null);
  // "Save this venue for next time" — only offered to someone who leads the
  // event's chapter (the venues insert policy's rule too).
  const [saveVenue, setSaveVenue] = useState(false);
  const canSaveVenue = allowedChapters.includes(form.chapter);

  const edit = (updater: (prev: EventEditInput) => EventEditInput) => {
    setForm(updater);
    setFieldError(null);
    setWarnings(null);
    setConfirmed(false);
    setNotifyPrompt(null);
    setScopePrompt(null);
    setScope(null);
  };

  const signedUp = (role: EditableVolunteerRole) =>
    role.id != null ? (signedUpByRoleId[role.id] ?? 0) : 0;

  const updateRole = (index: number, patch: Partial<EditableVolunteerRole>) =>
    edit((prev) => ({
      ...prev,
      volunteerRoles: prev.volunteerRoles.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }));

  const removeRole = (index: number) => {
    const role = form.volunteerRoles[index];
    if (role.id == null) {
      edit((prev) => ({
        ...prev,
        volunteerRoles: prev.volunteerRoles.filter((_, i) => i !== index),
      }));
    } else if (signedUp(role) > 0) {
      setCancelAsk(index);
    } else {
      updateRole(index, { removal: "delete" });
    }
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

  const save = async (
    notifyAttendees: boolean | null,
    alreadyConfirmed = confirmed,
    chosenScope: EditScope | null = scope,
  ) => {
    setError(null);
    setFieldError(null);

    const problem = fieldProblem(form);
    if (problem) {
      showFieldError(problem.field, problem.message);
      return;
    }
    const roleErrors = form.volunteerRoles.flatMap((role, i) =>
      role.removal
        ? []
        : volunteerRoleErrors(role, role.title.trim() || `Role ${i + 1}`, signedUp(role), form.requiresHealthHistory),
    );
    if (roleErrors.length > 0) {
      showFieldError("roles", roleErrors.join(". "));
      return;
    }

    setIsSaving(true);
    try {
      if (seriesId && chosenScope == null) {
        const summary = await seriesScopeSummaryAction(eventId);
        if (!summary.ok) {
          setError(summary.error);
          return;
        }
        setScopePrompt(summary);
        return;
      }

      const result = await updateEventAction(eventId, form, notifyAttendees, alreadyConfirmed, {
        scope: chosenScope ?? "this",
        applyOccurrenceNote,
      });

      if (!result.ok) {
        if (result.field) showFieldError(result.field, result.error);
        else setError(result.error);
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
        setNotifyPrompt({ confirmedCount: result.confirmedCount, eventCount: result.eventCount });
        return;
      }

      setNotifyPrompt(null);
      // After the event itself is saved, so a venue problem never blocks it.
      if (
        saveVenue &&
        canSaveVenue &&
        !findVenueByName(venuesForChapter(venues, form.chapter), form.venueName)
      ) {
        const venueResult = await saveVenueFromEventAction({
          venueName: form.venueName,
          streetAddress: form.streetAddress,
          city: form.city,
          state: form.state,
          postalCode: form.postalCode,
          chapter: form.chapter,
        });
        if (!venueResult.ok) {
          setError(`The event was saved, but the venue wasn't added to the saved list: ${venueResult.error}`);
          return;
        }
        setSaveVenue(false);
      }
      setSuccess(true);
      setTimeout(() => router.push(`/protected/admin/events/${eventId}`), 900);
    } catch (err) {
      console.error("Save event failed:", err);
      setError(
        "Couldn't reach the server to save the event. Check your connection and try again — nothing here was lost.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const showFieldError = (field: EventFormField, message: string) => {
    // A field this form has no slot for (e.g. the series' repeat settings)
    // goes by the Save button instead of vanishing.
    if (!FIELDS_WITH_SLOTS.has(field)) {
      setError(message);
      return;
    }
    setFieldError({ field, message });
    const id = FIELD_INPUT_IDS[field];
    // After the message renders under the field (its RevealPanel scrolls it
    // into view); focus the input itself when it has one.
    if (id) requestAnimationFrame(() => document.getElementById(`edit_${id}`)?.focus({ preventScroll: true }));
  };

  /** The field problem, if it's one of these fields' — rendered under them. */
  const problemFor = (...fields: EventFormField[]) =>
    fieldError && fields.includes(fieldError.field) ? (
      <RevealPanel role="alert" revealKey={fieldError.message} className="-mt-2 text-sm text-red-500">
        {fieldError.message}
      </RevealPanel>
    ) : null;

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
            {seriesId && (
              <p className="text-sm text-muted-foreground">
                This event is part of a{" "}
                <Link
                  href={`/protected/admin/events/series/${seriesId}`}
                  className="underline underline-offset-4"
                >
                  repeating series
                </Link>
                . When you save, you&apos;ll choose whether the changes apply to this event only or
                to this and all future events.
              </p>
            )}
            <div className="grid grid-cols-2 gap-4">
              <ChapterField
                idPrefix="edit"
                value={form.chapter}
                onChange={setField("chapter")}
                allowed={allowedChapters}
              />
              <EventTypeField
                idPrefix="edit"
                value={form.eventType}
                onChange={setField("eventType")}
                eventTypes={eventTypes}
              />
            </div>
            {problemFor("chapter", "event_type", "template")}
            <TitleField idPrefix="edit" value={form.name} onChange={setField("name")} />
            {problemFor("title")}
            <PublicLinkField
              base={publicUrlBase}
              value={form.slug}
              original={initial.slug}
              onChange={setField("slug")}
            />
            {problemFor("slug")}

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
            {problemFor("date", "time", "timezone")}

            {isVirtualChapter(form.chapter) ? (
              <VirtualEventFields
                idPrefix="edit"
                virtualLink={form.virtualLink}
                virtualAccessNotes={form.virtualAccessNotes}
                onChangeLink={setField("virtualLink")}
                onChangeAccessNotes={setField("virtualAccessNotes")}
              />
            ) : (
              <LocationFields
                idPrefix="edit"
                value={form}
                onChange={(patch) => edit((prev) => ({ ...prev, ...patch }))}
                required={false}
                legacyLocation={legacyLocation}
                venues={venues}
                chapter={form.chapter}
                saveVenue={saveVenue}
                onSaveVenueChange={canSaveVenue ? setSaveVenue : undefined}
              />
            )}
            {problemFor("venue", "street", "city", "state", "postal_code", "virtual_link")}

            <DescriptionField
              idPrefix="edit"
              value={form.description}
              onChange={setField("description")}
            />
            {problemFor("description")}

            <OccurrenceNoteField
              idPrefix="edit"
              value={form.occurrenceNote}
              onChange={setField("occurrenceNote")}
            />
            {problemFor("occurrence_note")}

            <CapacityField
              idPrefix="edit"
              value={form.capacity}
              onChange={setField("capacity")}
            />
            {problemFor("capacity")}

            <LeadContactFields
              idPrefix="edit"
              name={form.leadName}
              phone={form.leadPhone}
              email={form.leadEmail}
              onChangeName={setField("leadName")}
              onChangePhone={setField("leadPhone")}
              onChangeEmail={setField("leadEmail")}
              leadUserId={form.leadUserId}
              onChangeLeadUserId={setField("leadUserId")}
            />
            {problemFor("lead")}

            <CustomEmailNoteField
              idPrefix="edit"
              value={form.customEmailNote}
              onChange={setField("customEmailNote")}
            />
            {problemFor("custom_note")}

            <RegistrationSectionsFields
              idPrefix="edit"
              selected={form.registrationSections}
              onToggle={toggleSection}
            />
            {problemFor("sections")}

            <RequiresHealthHistoryField
              idPrefix="edit"
              checked={form.requiresHealthHistory}
              onChange={(checked) => edit((prev) => ({ ...prev, requiresHealthHistory: checked }))}
            />

            <p className="text-sm text-muted-foreground">
              Waiver: {waiverLabel ?? "not set (this chapter has no waiver state)"}
            </p>

            <MarketingBoostField
              idPrefix="edit"
              checked={form.boostTier1}
              onChange={(checked) => edit((prev) => ({ ...prev, boostTier1: checked }))}
              disabledReason={
                allowedChapters.includes(form.chapter)
                  ? undefined
                  : `Only an admin or a chapter lead for ${form.chapter || "this chapter"} can change this.`
              }
              note={
                seriesId
                  ? "Applies to this occurrence only — never the rest of the series, even when you save changes to all future events."
                  : undefined
              }
            />
            {problemFor("boost")}
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Volunteer roles</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {form.volunteerRoles.length === 0 && (
              <p className="text-sm text-muted-foreground">No volunteer roles at this event.</p>
            )}
            {form.volunteerRoles.map((role, i) => {
              const count = signedUp(role);
              const title = role.title.trim() || `Role ${i + 1}`;
              if (role.removal) {
                return (
                  <div
                    key={role.id ?? `new-${i}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed p-3 text-sm"
                  >
                    <span className="text-muted-foreground">
                      <span className="line-through">{title}</span> —{" "}
                      {role.removal === "delete"
                        ? "will be deleted when you save."
                        : count > 0
                          ? `will be cancelled when you save; ${count} ${count === 1 ? "signup is" : "signups are"} cancelled and emailed.`
                          : "will be cancelled when you save."}
                    </span>
                    <div className="flex gap-2">
                      {role.removal === "delete" && seriesId && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          title="Use this when other dates in the series have people signed up for this role"
                          onClick={() => updateRole(i, { removal: "cancel" })}
                        >
                          Cancel instead
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => updateRole(i, { removal: null })}
                      >
                        Undo
                      </Button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={role.id ?? `new-${i}`} className="flex flex-col gap-3 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Role {i + 1}</span>
                      {role.id == null ? (
                        <Badge variant="outline">New</Badge>
                      ) : (
                        <Badge variant="secondary">
                          {count} signed up
                        </Badge>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={cancelAsk === i}
                      onClick={() => removeRole(i)}
                    >
                      {cancelAsk === i ? "Confirm below" : "Remove"}
                    </Button>
                  </div>
                  {cancelAsk === i && (
                    <RevealPanel
                      aria-label={`Cancel ${title}?`}
                      className="flex flex-col gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
                    >
                      <p className="text-amber-700 dark:text-amber-400">
                        <strong>
                          {count} {count === 1 ? "volunteer is" : "volunteers are"}
                        </strong>{" "}
                        signed up for {title}, so it can&apos;t be deleted. Cancel the role
                        instead? Their signups are cancelled and they&apos;re emailed when you
                        save.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setCancelAsk(null);
                            updateRole(i, { removal: "cancel" });
                          }}
                        >
                          Cancel role
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setCancelAsk(null)}
                        >
                          Keep role
                        </Button>
                      </div>
                    </RevealPanel>
                  )}
                  <VolunteerRoleFields
                    idPrefix="edit"
                    index={i}
                    role={role}
                    roleTypes={roleTypesForEvent(
                      roleTypes,
                      form.requiresHealthHistory,
                      new Set(role.roleTypeId ? [Number(role.roleTypeId)] : []),
                    )}
                    signedUp={count}
                    onChange={(field, value) => updateRole(i, { [field]: value })}
                  />
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                edit((prev) => ({ ...prev, volunteerRoles: [...prev.volunteerRoles, emptyRole()] }))
              }
            >
              Add a role
            </Button>
            {problemFor("roles")}
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardContent className="flex flex-col gap-4 pt-6">
            {scopePrompt && (
              <SeriesScopeChoice
                summary={scopePrompt}
                action="edit"
                busy={isSaving}
                occurrenceNoteChanged={form.occurrenceNote.trim() !== initial.occurrenceNote.trim()}
                applyOccurrenceNote={applyOccurrenceNote}
                onApplyOccurrenceNoteChange={setApplyOccurrenceNote}
                onChoose={(choice) => {
                  setScope(choice);
                  setScopePrompt(null);
                  void save(null, confirmed, choice);
                }}
                onBack={() => setScopePrompt(null)}
              />
            )}

            {warnings && (
              <RevealPanel
                aria-label="Please confirm before saving"
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
                      void save(null, true, scope);
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
              </RevealPanel>
            )}

            {notifyPrompt && (
              <RevealPanel
                aria-label="Notify attendees?"
                className="flex flex-col gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3"
              >
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  This changes the date, time, location, or chapter for{" "}
                  <strong>{notifyPrompt.confirmedCount}</strong> confirmed{" "}
                  {notifyPrompt.confirmedCount === 1 ? "attendee" : "attendees"}
                  {notifyPrompt.eventCount > 1 && (
                    <>
                      {" "}
                      across <strong>{notifyPrompt.eventCount}</strong> events
                    </>
                  )}
                  . Send them an update email with a revised calendar invite?
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
              </RevealPanel>
            )}

            {error && (
              <RevealPanel role="alert" revealKey={error} className="text-sm text-red-500">
                {error}
              </RevealPanel>
            )}
            {success && (
              <RevealPanel role="status" className="text-sm text-green-600">
                Saved.
              </RevealPanel>
            )}
          </CardContent>
          <CardFooter className="flex gap-2">
            {!notifyPrompt && !warnings && !scopePrompt && (
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

/** The public page's slug. Normalized as it's typed (lowercase, dashes);
 * the old link keeps working after a change, which the hint says so an
 * admin isn't afraid to fix a typo. Never part of a series-wide edit. */
function PublicLinkField({
  base,
  value,
  original,
  onChange,
}: {
  base: string;
  value: string;
  original: string;
  onChange: (value: string) => void;
}) {
  const problem = value ? slugError(value) : null;
  return (
    <div className="grid gap-2">
      <Label htmlFor="edit_slug">Public link</Label>
      <div className="flex items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring">
        <span className="hidden whitespace-nowrap pl-3 text-sm text-muted-foreground sm:inline">
          {base}
        </span>
        <input
          id="edit_slug"
          className="h-9 w-full min-w-0 rounded-md bg-transparent px-2 text-sm outline-none"
          value={value}
          placeholder={original}
          onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))}
          onBlur={() => onChange(normalizeSlug(value) || original)}
          spellCheck={false}
          autoCapitalize="off"
        />
      </div>
      <p className={problem ? "text-xs text-red-500" : "text-xs text-muted-foreground"}>
        {problem ??
          (value !== original
            ? `The old link (/events/${original}) will keep working and send people here.`
            : "Printed and shared links use this. Changing it keeps the old link working.")}
      </p>
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
    case "series_capacity":
      return (
        <>
          Capacity {warning.newCapacity} is also below the people already confirmed or holding
          an offer on <strong>{warning.overDates.join(", ")}</strong>. Nobody is removed there
          either, and open waitlist offers that no longer fit are withdrawn.
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
