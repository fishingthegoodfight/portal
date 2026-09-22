"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  createEventAction,
  type CreateEventInput,
  type VolunteerRoleInput,
} from "@/lib/actions/admin-create-event";
import { generateRecurrenceDates, type RecurrenceFrequency } from "@/lib/admin/recurrence";
import { timezoneForChapter } from "@/lib/chapters";
import {
  CapacityField,
  CustomEmailNoteField,
  DescriptionField,
  EventTypeField,
  TitleField,
} from "@/components/admin/fields/event-text-fields";
import { capacityError } from "@/lib/event-capacity";
import { ChapterField } from "@/components/admin/fields/chapter-field";
import { LocationFields } from "@/components/admin/fields/location-fields";
import { VirtualEventFields } from "@/components/admin/fields/virtual-event-fields";
import { locationErrors } from "@/lib/event-location";
import { isVirtualChapter } from "@/lib/chapters";
import { defaultRegistrationSectionsFor } from "@/lib/event-types";
import { formatEventDateRange } from "@/lib/format-date";
import { REGISTRATION_SECTIONS } from "@/lib/registration-sections";
import { zonedDateTimeToUtc } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { DateTimeFields } from "@/components/admin/fields/datetime-fields";
import { LeadContactFields } from "@/components/admin/fields/lead-contact-fields";
import { RegistrationSectionsFields } from "@/components/admin/fields/registration-sections-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const DRAFT_KEY = "admin-event-create-draft";
const STEP_LABELS = ["Basics", "Details", "Volunteers", "Recurrence", "Review"];

type AdminPrefill = { leadName: string; leadEmail: string; leadPhone: string };

export type ChapterEventRoleType = { id: number; name: string };

function emptyForm(prefill: AdminPrefill): CreateEventInput {
  return {
    chapter: "",
    eventType: "",
    title: "",
    date: "",
    time: "",
    endTime: "",
    timezone: "",
    venueName: "",
    streetAddress: "",
    city: "",
    state: "",
    virtualLink: "",
    virtualAccessNotes: "",
    description: "",
    capacity: "",
    leadName: prefill.leadName,
    leadEmail: prefill.leadEmail,
    leadPhone: prefill.leadPhone,
    customEmailNote: "",
    registrationSections: [],
    volunteersNeeded: false,
    volunteerRoles: [],
    recurrence: "none",
    recurrenceEndDate: "",
  };
}

function emptyVolunteerRole(): VolunteerRoleInput {
  return {
    title: "",
    description: "",
    shiftStart: "",
    shiftEnd: "",
    whatToBring: "",
    numberNeeded: "1",
    roleTypeId: "",
  };
}

function sectionTitle(id: string): string {
  return REGISTRATION_SECTIONS.find((s) => s.id === id)?.title ?? id;
}

function step1Errors(form: CreateEventInput): string[] {
  const errors: string[] = [];
  if (!form.chapter) errors.push("Chapter is required");
  if (!form.eventType) errors.push("Event type is required");
  if (!form.title.trim()) errors.push("Title is required");
  if (!form.date) errors.push("Date is required");
  if (!form.time) errors.push("Start time is required");
  if (form.time && form.endTime && form.endTime <= form.time) {
    errors.push("End time must be after the start time");
  }
  if (form.date && form.date < new Date().toISOString().slice(0, 10)) {
    errors.push("Date can't be in the past");
  }
  return errors;
}

function step2Errors(form: CreateEventInput): string[] {
  const errors: string[] = [];
  if (isVirtualChapter(form.chapter)) {
    if (!form.virtualLink.trim()) errors.push("A meeting link is required for a virtual event");
  } else {
    errors.push(...locationErrors(form));
  }
  const capacityProblem = capacityError(form.capacity);
  if (capacityProblem) errors.push(capacityProblem);
  return errors;
}

function step3Errors(form: CreateEventInput): string[] {
  if (!form.volunteersNeeded) return [];
  const errors: string[] = [];
  if (form.volunteerRoles.length === 0) {
    errors.push('Add at least one volunteer role, or switch back to "No"');
  }
  form.volunteerRoles.forEach((role, i) => {
    const label = role.title.trim() || `Role ${i + 1}`;
    if (!role.title.trim()) errors.push(`${label}: title is required`);
    const needed = Number(role.numberNeeded.trim());
    if (!role.numberNeeded.trim() || !Number.isFinite(needed) || needed < 1) {
      errors.push(`${label}: number needed must be at least 1`);
    }
    if (!role.shiftStart || !role.shiftEnd) {
      errors.push(`${label}: shift start and end are required`);
    } else if (role.shiftEnd <= role.shiftStart) {
      errors.push(`${label}: shift end must be after shift start`);
    }
  });
  return errors;
}

function step4Errors(form: CreateEventInput): string[] {
  if (form.recurrence === "none") return [];
  const errors: string[] = [];
  if (!form.recurrenceEndDate) errors.push("An end date is required for a repeating event");
  else if (form.recurrenceEndDate < form.date) {
    errors.push("The repeat end date must be after the start date");
  }
  return errors;
}

function errorsForStep(step: number, form: CreateEventInput): string[] {
  if (step === 1) return step1Errors(form);
  if (step === 2) return step2Errors(form);
  if (step === 3) return step3Errors(form);
  if (step === 4) return step4Errors(form);
  return [];
}

export function EventCreateWizard({
  adminPrefill,
  roleTypes,
}: {
  adminPrefill: AdminPrefill;
  /** Active volunteer_role_types with for_chapter_events true — the only
   * ones offered for an event role (see lib/volunteers.ts). */
  roleTypes: ChapterEventRoleType[];
}) {
  const router = useRouter();
  const initialForm = useMemo(() => emptyForm(adminPrefill), [adminPrefill]);

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<CreateEventInput>(initialForm);
  const [timezoneOverridden, setTimezoneOverridden] = useState(false);
  const [stepErrors, setStepErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const hasRestoredDraft = useRef(false);
  const isSubmittedRef = useRef(false);

  // Restore a saved draft after mount, not during the initial render — the
  // server-rendered shell always shows the empty defaults, so restoring any
  // earlier than this would mismatch it and trip a hydration warning.
  useEffect(() => {
    if (hasRestoredDraft.current) return;
    hasRestoredDraft.current = true;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        form: CreateEventInput;
        step: number;
        timezoneOverridden: boolean;
      };
      setForm((prev) => ({ ...prev, ...draft.form }));
      setStep(draft.step);
      setTimezoneOverridden(draft.timezoneOverridden);
    } catch {
      // Corrupt or unreadable draft — ignore, start fresh.
    }
  }, []);

  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm);

  useEffect(() => {
    if (!isDirty) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, step, timezoneOverridden }));
    } catch {
      // Storage full or unavailable (private browsing) — persistence is a
      // nicety, not something to block on.
    }
  }, [form, step, timezoneOverridden, isDirty]);

  // Catches an actual page unload (tab close, refresh, typed URL) — the App
  // Router has no supported hook for intercepting in-app Link navigation,
  // so that case isn't covered.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty || isSubmittedRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const clearDraft = () => {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
  };

  const setField = <K extends keyof CreateEventInput>(field: K) => (value: CreateEventInput[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const updateChapter = (value: string) =>
    setForm((prev) => ({
      ...prev,
      chapter: value,
      timezone: timezoneOverridden ? prev.timezone : timezoneForChapter(value),
    }));

  const updateEventType = (value: string) =>
    setForm((prev) => {
      const oldDefault = defaultRegistrationSectionsFor(prev.eventType);
      const stillDefault =
        prev.registrationSections.length === oldDefault.length &&
        prev.registrationSections.every((id) => oldDefault.includes(id));
      return {
        ...prev,
        eventType: value,
        registrationSections: stillDefault
          ? defaultRegistrationSectionsFor(value)
          : prev.registrationSections,
      };
    });

  const toggleSection = (id: string, checked: boolean) =>
    setForm((prev) => ({
      ...prev,
      registrationSections: checked
        ? [...prev.registrationSections, id]
        : prev.registrationSections.filter((s) => s !== id),
    }));

  const addRole = () =>
    setForm((prev) => ({ ...prev, volunteerRoles: [...prev.volunteerRoles, emptyVolunteerRole()] }));
  const removeRole = (index: number) =>
    setForm((prev) => ({
      ...prev,
      volunteerRoles: prev.volunteerRoles.filter((_, i) => i !== index),
    }));
  const updateRole = (index: number, field: keyof VolunteerRoleInput, value: string) =>
    setForm((prev) => ({
      ...prev,
      volunteerRoles: prev.volunteerRoles.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    }));

  const occurrenceDates = useMemo(() => {
    if (!form.date) return [];
    if (form.recurrence === "none") return [form.date];
    if (!form.recurrenceEndDate || form.recurrenceEndDate < form.date) return [form.date];
    try {
      return generateRecurrenceDates(form.date, form.recurrence, form.recurrenceEndDate);
    } catch {
      return [form.date];
    }
  }, [form.date, form.recurrence, form.recurrenceEndDate]);

  const goToStep = (n: number) => {
    setStepErrors([]);
    setStep(n);
  };

  const goNext = () => {
    const errors = errorsForStep(step, form);
    if (errors.length > 0) {
      setStepErrors(errors);
      return;
    }
    setStepErrors([]);
    setStep((s) => s + 1);
  };

  const handleCreate = async () => {
    const allErrors = [1, 2, 3, 4].flatMap((n) => errorsForStep(n, form));
    if (allErrors.length > 0) {
      setStepErrors(allErrors);
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const result = await createEventAction(form);
    setIsSubmitting(false);

    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }
    isSubmittedRef.current = true;
    clearDraft();
    router.push(`/protected/admin/events/${result.eventIds[0]}`);
  };

  const whenPreview = (() => {
    if (!form.date || !form.time || !form.timezone) return null;
    try {
      return formatEventDateRange(
        zonedDateTimeToUtc(form.date, form.time, form.timezone).toISOString(),
        form.endTime ? zonedDateTimeToUtc(form.date, form.endTime, form.timezone).toISOString() : null,
        form.timezone,
      );
    } catch {
      return null;
    }
  })();

  return (
    <Card>
      <CardHeader>
        <CardTitle>New event</CardTitle>
        <div className="flex flex-wrap gap-1 pt-2">
          {STEP_LABELS.map((label, i) => {
            const n = i + 1;
            const reachable = n <= step;
            return (
              <button
                key={label}
                type="button"
                disabled={!reachable}
                onClick={() => reachable && goToStep(n)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs transition-colors",
                  n === step
                    ? "bg-foreground text-background font-medium"
                    : reachable
                      ? "text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      : "text-muted-foreground/50",
                )}
              >
                {n}. {label}
              </button>
            );
          })}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <ChapterField idPrefix="create" value={form.chapter} onChange={updateChapter} />
              <EventTypeField idPrefix="create" value={form.eventType} onChange={updateEventType} />
            </div>
            <TitleField idPrefix="create" value={form.title} onChange={setField("title")} />
            {form.chapter ? (
              <DateTimeFields
                idPrefix="create"
                date={form.date}
                time={form.time}
                endTime={form.endTime}
                timezone={form.timezone}
                onChangeDate={setField("date")}
                onChangeTime={setField("time")}
                onChangeEndTime={setField("endTime")}
                onChangeTimezone={setField("timezone")}
                timezoneDerived
                onOverrideTimezone={() => setTimezoneOverridden(true)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Choose a chapter to set the date, time, and time zone.
              </p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            {isVirtualChapter(form.chapter) ? (
              <VirtualEventFields
                idPrefix="create"
                virtualLink={form.virtualLink}
                virtualAccessNotes={form.virtualAccessNotes}
                onChangeLink={setField("virtualLink")}
                onChangeAccessNotes={setField("virtualAccessNotes")}
              />
            ) : (
              <LocationFields
                idPrefix="create"
                value={form}
                onChange={(field, value) => setField(field)(value)}
              />
            )}

            <DescriptionField
              idPrefix="create"
              value={form.description}
              onChange={setField("description")}
            />

            <CapacityField idPrefix="create" value={form.capacity} onChange={setField("capacity")} />

            <LeadContactFields
              idPrefix="create"
              name={form.leadName}
              phone={form.leadPhone}
              email={form.leadEmail}
              onChangeName={setField("leadName")}
              onChangePhone={setField("leadPhone")}
              onChangeEmail={setField("leadEmail")}
            />

            <CustomEmailNoteField
              idPrefix="create"
              value={form.customEmailNote}
              onChange={setField("customEmailNote")}
            />

            <RegistrationSectionsFields
              idPrefix="create"
              selected={form.registrationSections}
              onToggle={toggleSection}
            />

          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-2">
              <span className="text-sm font-medium">Are volunteers needed?</span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={form.volunteersNeeded ? "default" : "outline"}
                  onClick={() => setForm((prev) => ({ ...prev, volunteersNeeded: true }))}
                >
                  Yes
                </Button>
                <Button
                  type="button"
                  variant={!form.volunteersNeeded ? "default" : "outline"}
                  onClick={() =>
                    setForm((prev) => ({ ...prev, volunteersNeeded: false, volunteerRoles: [] }))
                  }
                >
                  No
                </Button>
              </div>
            </div>

            {form.volunteersNeeded && (
              <div className="flex flex-col gap-4">
                {form.volunteerRoles.map((role, i) => (
                  <div key={i} className="flex flex-col gap-3 rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Role {i + 1}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeRole(i)}>
                        Remove
                      </Button>
                    </div>
                    {roleTypes.length > 0 && (
                      <div className="grid gap-2">
                        <Label htmlFor={`role_${i}_role_type`}>Role type</Label>
                        <Select
                          id={`role_${i}_role_type`}
                          value={role.roleTypeId}
                          onChange={(e) => {
                            const roleTypeId = e.target.value;
                            const matched = roleTypes.find((rt) => String(rt.id) === roleTypeId);
                            setForm((prev) => ({
                              ...prev,
                              volunteerRoles: prev.volunteerRoles.map((r, ri) =>
                                ri === i
                                  ? {
                                      ...r,
                                      roleTypeId,
                                      title: matched && !r.title.trim() ? matched.name : r.title,
                                    }
                                  : r,
                              ),
                            }));
                          }}
                        >
                          <option value="">Custom / other (no role type)</option>
                          {roleTypes.map((rt) => (
                            <option key={rt.id} value={rt.id}>
                              {rt.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                    )}
                    <div className="grid gap-2">
                      <Label htmlFor={`role_${i}_title`}>Title</Label>
                      <Input
                        id={`role_${i}_title`}
                        required
                        value={role.title}
                        onChange={(e) => updateRole(i, "title", e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`role_${i}_description`}>Description</Label>
                      <Textarea
                        id={`role_${i}_description`}
                        value={role.description}
                        onChange={(e) => updateRole(i, "description", e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor={`role_${i}_shift_start`}>Shift start</Label>
                        <Input
                          id={`role_${i}_shift_start`}
                          type="time"
                          required
                          value={role.shiftStart}
                          onChange={(e) => updateRole(i, "shiftStart", e.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={`role_${i}_shift_end`}>Shift end</Label>
                        <Input
                          id={`role_${i}_shift_end`}
                          type="time"
                          required
                          value={role.shiftEnd}
                          onChange={(e) => updateRole(i, "shiftEnd", e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`role_${i}_bring`}>What to bring or wear</Label>
                      <Input
                        id={`role_${i}_bring`}
                        placeholder="Optional"
                        value={role.whatToBring}
                        onChange={(e) => updateRole(i, "whatToBring", e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`role_${i}_needed`}>Number needed</Label>
                      <Input
                        id={`role_${i}_needed`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        required
                        value={role.numberNeeded}
                        onChange={(e) => updateRole(i, "numberNeeded", e.target.value)}
                      />
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={addRole}>
                  Add another role
                </Button>
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="create_recurrence">Repeats</Label>
              <Select
                id="create_recurrence"
                value={form.recurrence}
                onChange={(e) =>
                  setField("recurrence")(e.target.value as "none" | RecurrenceFrequency)
                }
              >
                <option value="none">One-time</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every other week</option>
                <option value="monthly">Monthly, same weekday</option>
              </Select>
            </div>

            {form.recurrence !== "none" && (
              <div className="grid gap-2">
                <Label htmlFor="create_recurrence_end">Repeat until</Label>
                <Input
                  id="create_recurrence_end"
                  type="date"
                  required
                  value={form.recurrenceEndDate}
                  onChange={(e) => setField("recurrenceEndDate")(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">
                  Capped at 52 occurrences even if this date would generate more.
                </span>
              </div>
            )}

            {occurrenceDates.length > 1 && (
              <div className="rounded-md border p-3">
                <p className="mb-2 text-sm font-medium">
                  {occurrenceDates.length} events will be created:
                </p>
                <ul className="grid max-h-48 grid-cols-2 gap-x-4 overflow-y-auto text-sm text-muted-foreground sm:grid-cols-3">
                  {occurrenceDates.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {step === 5 && (
          <div className="flex flex-col gap-4">
            <ReviewSection title="Basics" onEdit={() => goToStep(1)}>
              <ReviewRow label="Chapter" value={form.chapter} />
              <ReviewRow label="Event type" value={form.eventType} />
              <ReviewRow label="Title" value={form.title} />
              <ReviewRow label="When" value={whenPreview ?? "—"} />
            </ReviewSection>

            <ReviewSection title="Details" onEdit={() => goToStep(2)}>
              {isVirtualChapter(form.chapter) ? (
                <ReviewRow label="Meeting link" value={form.virtualLink || "—"} />
              ) : (
                <ReviewRow
                  label="Location"
                  value={[form.venueName, form.streetAddress, `${form.city}, ${form.state}`]
                    .filter(Boolean)
                    .join(", ")}
                />
              )}
              <ReviewRow label="Description" value={form.description || "—"} />
              <ReviewRow label="Capacity" value={form.capacity.trim() || "Unlimited"} />
              <ReviewRow
                label="Lead contact"
                value={[form.leadName, form.leadPhone, form.leadEmail].filter(Boolean).join(" · ") || "—"}
              />
              <ReviewRow label="Custom email note" value={form.customEmailNote.trim() || "—"} />
              <ReviewRow
                label="Registration sections"
                value={
                  form.registrationSections.length > 0
                    ? form.registrationSections.map(sectionTitle).join(", ")
                    : "None"
                }
              />
            </ReviewSection>

            <ReviewSection title="Volunteers" onEdit={() => goToStep(3)}>
              {form.volunteersNeeded && form.volunteerRoles.length > 0 ? (
                form.volunteerRoles.map((role, i) => (
                  <ReviewRow
                    key={i}
                    label={role.title || `Role ${i + 1}`}
                    value={`${role.numberNeeded} needed · ${role.shiftStart}–${role.shiftEnd}`}
                  />
                ))
              ) : (
                <ReviewRow label="Volunteers" value="Not needed" />
              )}
            </ReviewSection>

            <ReviewSection title="Recurrence" onEdit={() => goToStep(4)}>
              <ReviewRow
                label="Pattern"
                value={
                  form.recurrence === "none"
                    ? "One-time"
                    : `${form.recurrence}, through ${form.recurrenceEndDate}`
                }
              />
              <ReviewRow label="Occurrences" value={String(occurrenceDates.length)} />
              {occurrenceDates.length > 1 && (
                <div className="text-sm text-muted-foreground">
                  {occurrenceDates.join(", ")}
                </div>
              )}
            </ReviewSection>
          </div>
        )}

        {stepErrors.length > 0 && (
          <div className="rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
            <ul className="list-disc pl-4">
              {stepErrors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          </div>
        )}
        {submitError && <p className="text-sm text-red-500">{submitError}</p>}
      </CardContent>
      <CardFooter className="flex justify-between gap-2">
        <div>
          {step > 1 && (
            <Button type="button" variant="outline" onClick={() => goToStep(step - 1)}>
              Back
            </Button>
          )}
        </div>
        <div>
          {step < 5 ? (
            <Button type="button" onClick={goNext}>
              Next
            </Button>
          ) : (
            <Button type="button" disabled={isSubmitting} onClick={handleCreate}>
              {isSubmitting ? "Creating..." : "Create"}
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}

function ReviewSection({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">{title}</span>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Edit
        </button>
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col text-sm sm:flex-row sm:gap-2">
      <span className="shrink-0 font-medium">{label}:</span>
      <span className="text-muted-foreground">{value}</span>
    </div>
  );
}
