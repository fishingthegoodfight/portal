"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  OccurrenceNoteField,
  TitleField,
} from "@/components/admin/fields/event-text-fields";
import { capacityError } from "@/lib/event-capacity";
import { ChapterField } from "@/components/admin/fields/chapter-field";
import { LocationFields } from "@/components/admin/fields/location-fields";
import { VirtualEventFields } from "@/components/admin/fields/virtual-event-fields";
import {
  composeLocation,
  isLocationEmpty,
  locationErrors,
  type LocationFieldsValue,
} from "@/lib/event-location";
import { isVirtualChapter } from "@/lib/chapters";
import type { EventTypeOption } from "@/lib/event-types";
import {
  templateLocation,
  type EventTemplateWithRoles,
  type ShiftAnchor,
} from "@/lib/event-templates";
import { saveVenueFromEventAction } from "@/lib/actions/venues";
import type { EventFormField, EventFormStep } from "@/lib/event-db-errors";
import { findVenueByName, venuesForChapter, type Venue } from "@/lib/venues";
import { formatEventDateRange } from "@/lib/format-date";
import { REGISTRATION_SECTIONS } from "@/lib/registration-sections";
import { zonedDateTimeToUtc } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { DateTimeFields } from "@/components/admin/fields/datetime-fields";
import { LeadContactFields } from "@/components/admin/fields/lead-contact-fields";
import { MarketingBoostField } from "@/components/admin/fields/marketing-boost-field";
import { RequiresHealthHistoryField } from "@/components/admin/fields/requires-health-history-field";
import { RegistrationSectionsFields } from "@/components/admin/fields/registration-sections-fields";
import {
  roleTypesForEvent,
  VolunteerRoleFields,
  volunteerRoleErrors,
} from "@/components/admin/fields/volunteer-role-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const DRAFT_KEY = "admin-event-create-draft";
const STEP_LABELS = ["Basics", "Details", "Volunteers", "Recurrence & marketing", "Review"];

type AdminPrefill = { leadName: string; leadEmail: string; leadPhone: string };

export type ChapterEventRoleType = {
  id: number;
  name: string;
  for_chapter_events?: boolean;
  for_retreats?: boolean;
};

function emptyForm(prefill: AdminPrefill): CreateEventInput {
  return {
    templateId: "",
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
    postalCode: "",
    virtualLink: "",
    virtualAccessNotes: "",
    description: "",
    occurrenceNote: "",
    capacity: "",
    leadName: prefill.leadName,
    leadEmail: prefill.leadEmail,
    leadPhone: prefill.leadPhone,
    leadUserId: "",
    customEmailNote: "",
    registrationSections: [],
    requiresHealthHistory: false,
    volunteersNeeded: false,
    volunteerRoles: [],
    recurrence: "none",
    recurrenceEndDate: "",
    boostTier1: false,
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

/** Error field -> the suffix of its input's id (`create_<suffix>`). */
const FIELD_INPUT_IDS: Partial<Record<EventFormField, string>> = {
  chapter: "chapter",
  event_type: "event_type",
  title: "title",
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
  recurrence: "recurrence",
  template: "template",
  boost: "boost",
};

const CHOOSE_CHAPTER_FIRST = "Choose a chapter to set the date and time";

function step1Errors(form: CreateEventInput): string[] {
  const errors: string[] = [];
  // The date and time fields only appear once a chapter is chosen (it sets
  // the time zone), so without one, say that first and don't name fields
  // that aren't on screen yet.
  if (!form.chapter) errors.push(CHOOSE_CHAPTER_FIRST);
  if (!form.eventType) errors.push("Event type is required");
  if (!form.title.trim()) errors.push("Title is required");
  if (!form.chapter) return errors;
  if (!form.date) errors.push("Date is required");
  if (!form.time) errors.push("Start time is required");
  if (form.time && form.endTime && form.endTime <= form.time) {
    errors.push("End time must be after the start time");
  }
  if (form.date && form.date < new Date().toISOString().slice(0, 10)) {
    errors.push("Date can't be in the past");
  } else if (form.date && form.time && form.timezone) {
    // Today, but a start time that's already gone by in the event's own zone
    // — the server refuses it, so say so here rather than at Create.
    try {
      if (zonedDateTimeToUtc(form.date, form.time, form.timezone).getTime() < Date.now()) {
        errors.push("That start time has already passed");
      }
    } catch {
      // An unparseable date/time is reported by the fields themselves.
    }
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
    errors.push(...volunteerRoleErrors(role, role.title.trim() || `Role ${i + 1}`, 0, form.requiresHealthHistory));
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

/** Minutes -> "HH:MM", wrapping within a day — a role's shift always stays on
 * the same calendar date as the event occurrence itself (see
 * admin-create-event.ts), so offsets never need to cross midnight. */
function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Resolves a template role boundary's actual HH:MM time. An end anchored to
 * event_end with no event end time has nothing to anchor to, so it falls
 * back to event start + the same offset — `fellBack` tells the caller to
 * flag that for the admin to fix by hand. */
function resolveShiftTime(
  anchor: ShiftAnchor,
  offsetMinutes: number,
  eventStartTime: string,
  eventEndTime: string,
): { time: string; fellBack: boolean } {
  if (anchor === "event_end") {
    if (eventEndTime) return { time: addMinutesToTime(eventEndTime, offsetMinutes), fellBack: false };
    return { time: addMinutesToTime(eventStartTime, offsetMinutes), fellBack: true };
  }
  return { time: addMinutesToTime(eventStartTime, offsetMinutes), fellBack: false };
}

type TemplateRoleTracking = {
  startAnchor: ShiftAnchor;
  startOffset: number;
  endAnchor: ShiftAnchor;
  endOffset: number;
} | null;

export function EventCreateWizard({
  adminPrefill,
  roleTypes,
  eventTypes,
  templates,
  allowedChapters,
  venues,
}: {
  adminPrefill: AdminPrefill;
  /** The chapters this person may create events in (manageable_chapters). */
  allowedChapters: string[];
  /** Active volunteer_role_types with for_chapter_events true — the only
   * ones offered for an event role (see lib/volunteers.ts). */
  roleTypes: ChapterEventRoleType[];
  /** Active event_types, for the "Event type" picker. */
  eventTypes: EventTypeOption[];
  /** Active event_templates with their roles, for the "Start from a
   * template" picker — filtered client-side to the selected chapter. */
  templates: EventTemplateWithRoles[];
  /** Active saved venues, for the venue picker. */
  venues: Venue[];
}) {
  const router = useRouter();
  const initialForm = useMemo(() => emptyForm(adminPrefill), [adminPrefill]);

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<CreateEventInput>(initialForm);
  const [timezoneOverridden, setTimezoneOverridden] = useState(false);
  const [stepErrors, setStepErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // "Save this venue for next time" — only offered in a chapter this person
  // leads (the venues insert policy's rule too).
  const [saveVenue, setSaveVenue] = useState(false);
  const canSaveVenue = allowedChapters.includes(form.chapter);
  const cardRef = useRef<HTMLDivElement>(null);
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
        saveVenue?: boolean;
      };
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Restoring a saved draft from localStorage, which only exists in the browser: reading it during render would mismatch the server-rendered HTML, so it has to happen after mount (once, guarded by hasRestoredDraft).
      setForm((prev) => ({ ...prev, ...draft.form }));
      setStep(draft.step);
      setTimezoneOverridden(draft.timezoneOverridden);
      setSaveVenue(draft.saveVenue ?? false);
    } catch {
      // Corrupt or unreadable draft — ignore, start fresh.
    }
  }, []);

  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm);

  useEffect(() => {
    // After a successful create the finished form is still in state until the
    // page is hidden (see the reset below) — never write it back as a draft.
    if (!isDirty || isSubmittedRef.current) return;
    try {
      window.localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ form, step, timezoneOverridden, saveVenue }),
      );
    } catch {
      // Storage full or unavailable (private browsing) — persistence is a
      // nicety, not something to block on.
    }
  }, [form, step, timezoneOverridden, saveVenue, isDirty]);

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

  const defaultSectionsFor = (eventType: string): string[] =>
    eventTypes.find((t) => t.name === eventType)?.default_registration_sections ?? [];

  const requiresHealthFor = (eventType: string): boolean =>
    eventTypes.find((t) => t.name === eventType)?.requires_health_history ?? false;

  const updateEventType = (value: string) =>
    setForm((prev) => {
      const oldDefault = defaultSectionsFor(prev.eventType);
      const stillDefault =
        prev.registrationSections.length === oldDefault.length &&
        prev.registrationSections.every((id) => oldDefault.includes(id));
      // Same rule for the health form: follows the type unless changed by hand.
      const healthStillDefault = prev.requiresHealthHistory === requiresHealthFor(prev.eventType);
      return {
        ...prev,
        eventType: value,
        registrationSections: stillDefault ? defaultSectionsFor(value) : prev.registrationSections,
        requiresHealthHistory: healthStillDefault ? requiresHealthFor(value) : prev.requiresHealthHistory,
      };
    });

  const toggleSection = (id: string, checked: boolean) =>
    setForm((prev) => ({
      ...prev,
      registrationSections: checked
        ? [...prev.registrationSections, id]
        : prev.registrationSections.filter((s) => s !== id),
    }));

  // --- "Start from a template" (top of step 1) ---
  // templateRoleTracking[i] mirrors form.volunteerRoles[i]: the anchors +
  // offsets it came from, kept in sync so a later date/time entry can
  // recompute its HH:MM shift times — until the admin edits that role's
  // times by hand, at which point its entry is cleared and it stops
  // tracking the template.
  const [templateRoleTracking, setTemplateRoleTracking] = useState<TemplateRoleTracking[]>([]);

  // With cacheComponents on, navigating away after a successful create
  // doesn't unmount this wizard — Next.js hides the page in <Activity> and
  // keeps its state, and every effect re-runs when it's shown again. So
  // "Admin > New event" would reopen on the Review step of the event just
  // created, and the draft-saving effect would write that back to
  // localStorage. Reset to a blank form when the page is hidden after a
  // successful submit (see node_modules/next/dist/docs/01-app/02-guides/
  // preserving-ui-state.md, "Resetting stale status messages"). A draft the
  // admin navigated away from WITHOUT submitting is left alone.
  useLayoutEffect(() => {
    return () => {
      if (!isSubmittedRef.current) return;
      isSubmittedRef.current = false;
      setForm(initialForm);
      setStep(1);
      setTimezoneOverridden(false);
      setTemplateRoleTracking([]);
      setStepErrors([]);
      setSubmitError(null);
      setIsSubmitting(false);
      setSaveVenue(false);
    };
  }, [initialForm]);

  // Before a chapter is chosen every template is offered (picking a
  // chapter-specific one sets the chapter); after, only that chapter's and
  // the all-chapter ones — plus whichever is already selected, so the picker
  // never shows a selection that isn't in its list.
  // Never a template for a chapter this person can't create events in.
  const templatesForChapter = templates.filter(
    (t) =>
      (t.chapter === null || allowedChapters.includes(t.chapter)) &&
      (!form.chapter ||
        t.chapter === null ||
        t.chapter === form.chapter ||
        String(t.id) === form.templateId),
  );

  // Title and location only follow the template while they still hold what
  // the previously applied template put there (or nothing) — once the admin
  // has typed their own, switching templates keeps it unless the new
  // template has its own value to replace it with. A template with no title
  // (or location) never leaves the previous template's behind.
  const currentTemplate = templates.find((t) => String(t.id) === form.templateId);
  const formLocation = (f: CreateEventInput): LocationFieldsValue => ({
    venueName: f.venueName,
    streetAddress: f.streetAddress,
    city: f.city,
    state: f.state,
    postalCode: f.postalCode,
  });
  const titleIsOwn = (f: CreateEventInput) =>
    f.title.trim() !== "" && f.title.trim() !== (currentTemplate?.default_title ?? "").trim();
  const locationIsOwn = (f: CreateEventInput) =>
    !isLocationEmpty(formLocation(f)) &&
    (!currentTemplate ||
      JSON.stringify(formLocation(f)) !== JSON.stringify(templateLocation(currentTemplate)));

  // The fields `next` (a template, or null to clear) would overwrite that
  // hold something — decides whether switching or clearing asks first, and
  // what it names.
  const templateOverwrites = (next: EventTemplateWithRoles | null): string[] => {
    const fields: string[] = [];
    if (next?.default_title?.trim() && titleIsOwn(form)) fields.push("title");
    if (form.description.trim()) fields.push("description");
    if (next && !isLocationEmpty(templateLocation(next)) && locationIsOwn(form)) {
      fields.push("location");
    }
    if (form.capacity.trim()) fields.push("capacity");
    if (form.registrationSections.length > 0) fields.push("registration sections");
    if (form.virtualLink.trim() || form.virtualAccessNotes.trim()) fields.push("virtual details");
    if (form.volunteerRoles.length > 0) fields.push("volunteer roles");
    return fields;
  };

  const roleTypeName = (id: number) => roleTypes.find((rt) => rt.id === id)?.name ?? "";

  const applyTemplate = (template: EventTemplateWithRoles) => {
    const sortedRoles = template.roles.slice().sort((a, b) => a.sort_order - b.sort_order);
    const location = templateLocation(template);
    const hasLocation = !isLocationEmpty(location);
    setForm((prev) => ({
      ...prev,
      templateId: String(template.id),
      title: template.default_title?.trim() || (titleIsOwn(prev) ? prev.title : ""),
      ...(hasLocation
        ? location
        : locationIsOwn(prev)
          ? {}
          : { venueName: "", streetAddress: "", city: "", state: "", postalCode: "" }),
      ...(template.chapter && template.chapter !== prev.chapter
        ? {
            chapter: template.chapter,
            timezone: timezoneOverridden ? prev.timezone : timezoneForChapter(template.chapter),
          }
        : {}),
      eventType: template.event_type,
      requiresHealthHistory: requiresHealthFor(template.event_type),
      description: template.description ?? "",
      capacity: template.default_capacity != null ? String(template.default_capacity) : "",
      registrationSections: template.default_registration_sections,
      virtualLink: template.default_virtual_link ?? "",
      virtualAccessNotes: template.default_virtual_access_notes ?? "",
      volunteersNeeded: sortedRoles.length > 0,
      volunteerRoles: sortedRoles.map((r) => {
        const start = prev.time
          ? resolveShiftTime(r.shift_start_anchor, r.shift_start_offset, prev.time, prev.endTime)
          : null;
        const end = prev.time
          ? resolveShiftTime(r.shift_end_anchor, r.shift_end_offset, prev.time, prev.endTime)
          : null;
        return {
          // The template's own label if it has one, else the role type's
          // name — either way it's the same editable title field as a role
          // added by hand.
          title: r.title?.trim() || roleTypeName(r.role_type_id),
          description: r.description ?? "",
          shiftStart: start?.time ?? "",
          shiftEnd: end?.time ?? "",
          whatToBring: r.what_to_bring ?? "",
          numberNeeded: String(r.number_needed),
          roleTypeId: String(r.role_type_id),
        };
      }),
    }));
    setTemplateRoleTracking(
      sortedRoles.map((r) => ({
        startAnchor: r.shift_start_anchor,
        startOffset: r.shift_start_offset,
        endAnchor: r.shift_end_anchor,
        endOffset: r.shift_end_offset,
      })),
    );
  };

  const clearTemplateFields = () => {
    setForm((prev) => ({
      ...prev,
      templateId: "",
      title: titleIsOwn(prev) ? prev.title : "",
      ...(locationIsOwn(prev)
        ? {}
        : { venueName: "", streetAddress: "", city: "", state: "", postalCode: "" }),
      description: "",
      capacity: "",
      registrationSections: [],
      virtualLink: "",
      virtualAccessNotes: "",
      volunteersNeeded: false,
      volunteerRoles: [],
    }));
    setTemplateRoleTracking([]);
  };

  const handleTemplateChange = (value: string) => {
    const template = value ? templates.find((t) => String(t.id) === value) ?? null : null;
    const overwrites = templateOverwrites(template);
    const list =
      overwrites.length > 1
        ? `${overwrites.slice(0, -1).join(", ")}, and ${overwrites[overwrites.length - 1]}`
        : overwrites[0];
    if (
      overwrites.length > 0 &&
      !window.confirm(
        value
          ? `Choosing a different template will overwrite the ${list} you've already entered. Continue?`
          : `Clearing the template will reset the ${list} it filled in. Continue?`,
      )
    ) {
      return;
    }
    if (!template) {
      clearTemplateFields();
      return;
    }
    applyTemplate(template);
  };

  // Once a date/time exist, keep any still-template-derived role's shift
  // times in sync with the template's anchors + offsets — an end anchor
  // that's now resolvable (e.g. an end time was just entered) recomputes off
  // event_end instead of the event_start fallback.
  useEffect(() => {
    if (!form.time || !templateRoleTracking.some(Boolean)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Works and is tested: resyncs template-derived shift times when the event's start/end changes; never overwrites a shift the admin edited (editing clears its tracking). Worth revisiting next time someone's in this file: compute the times in the time-change handler instead, which also removes the one render where they lag.
    setForm((prev) => ({
      ...prev,
      volunteerRoles: prev.volunteerRoles.map((role, i) => {
        const t = templateRoleTracking[i];
        if (!t) return role;
        const start = resolveShiftTime(t.startAnchor, t.startOffset, prev.time, prev.endTime);
        const end = resolveShiftTime(t.endAnchor, t.endOffset, prev.time, prev.endTime);
        return { ...role, shiftStart: start.time, shiftEnd: end.time };
      }),
    }));
  }, [form.time, form.endTime, templateRoleTracking]);

  // Template-derived roles still tracking an event_end anchor while the
  // event itself has no end time — their shown end time fell back to
  // event start + offset, so it needs a manual look before this is trusted.
  const templateEndFallbackRoles = form.volunteerRoles
    .map((role, i) => ({ role, i, tracking: templateRoleTracking[i] }))
    .filter(({ tracking }) => tracking?.endAnchor === "event_end" && !form.endTime)
    .map(({ role, i }) => role.title.trim() || `Role ${i + 1}`);

  const addRole = () => {
    setForm((prev) => ({ ...prev, volunteerRoles: [...prev.volunteerRoles, emptyVolunteerRole()] }));
    setTemplateRoleTracking((prev) => [...prev, null]);
  };
  const removeRole = (index: number) => {
    setForm((prev) => ({
      ...prev,
      volunteerRoles: prev.volunteerRoles.filter((_, i) => i !== index),
    }));
    setTemplateRoleTracking((prev) => prev.filter((_, i) => i !== index));
  };
  const updateRole = (index: number, field: keyof VolunteerRoleInput, value: string) => {
    setForm((prev) => ({
      ...prev,
      volunteerRoles: prev.volunteerRoles.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    }));
    // A manual edit to a template-derived role's own shift times stops it
    // tracking the template's anchors — further date/time changes leave it
    // alone from here on.
    if (field === "shiftStart" || field === "shiftEnd") {
      setTemplateRoleTracking((prev) => prev.map((t, i) => (i === index ? null : t)));
    }
  };

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

  // Each step starts at its own top — otherwise a long step leaves you
  // scrolled to wherever the previous one's Next button was.
  const scrollToTop = () =>
    requestAnimationFrame(() =>
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );

  const goToStep = (n: number) => {
    setStepErrors([]);
    setStep(n);
    scrollToTop();
  };

  const goNext = () => {
    const errors = errorsForStep(step, form);
    if (errors.length > 0) {
      setStepErrors(errors);
      return;
    }
    setStepErrors([]);
    setStep((s) => s + 1);
    scrollToTop();
  };

  /** Back to the step that owns a problem, with the message shown there and
   * — when it's one field's — that field focused. */
  const showOnStep = (n: EventFormStep, errors: string[], field?: EventFormField) => {
    goToStep(n);
    setStepErrors(errors);
    const id = field && FIELD_INPUT_IDS[field];
    if (id) {
      // After the step renders.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => document.getElementById(`create_${id}`)?.focus({ preventScroll: true })),
      );
    }
  };

  const handleCreate = async () => {
    // Every step is re-checked here (a restored draft, or an edit made by
    // jumping back), and the first one with a problem is reopened.
    for (const n of [1, 2, 3, 4] as const) {
      const errors = errorsForStep(n, form);
      if (errors.length > 0) {
        showOnStep(n, errors);
        return;
      }
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await submit();
    } catch (err) {
      // A dropped connection or a server crash — never leave the button
      // stuck on "Creating...".
      console.error("Create event failed:", err);
      setIsSubmitting(false);
      setSubmitError(
        "Couldn't reach the server to create the event. Check your connection and try again — nothing was created unless the Manage events list says otherwise.",
      );
    }
  };

  const submit = async () => {
    // Saved before the event, so a problem here can't leave a created event
    // behind to be duplicated on retry.
    if (
      saveVenue &&
      canSaveVenue &&
      !isVirtualChapter(form.chapter) &&
      !findVenueByName(venuesForChapter(venues, form.chapter), form.venueName)
    ) {
      const venueResult = await saveVenueFromEventAction({ ...formLocation(form), chapter: form.chapter });
      if (!venueResult.ok) {
        setIsSubmitting(false);
        showOnStep(
          2,
          [
            `Couldn't save the venue for next time: ${venueResult.error}. Untick "Save this venue for next time" to create the event without saving it.`,
          ],
          "venue",
        );
        return;
      }
    }

    const result = await createEventAction(form);
    if (!result.ok) {
      setIsSubmitting(false);
      if (result.step) showOnStep(result.step, [result.error], result.field);
      else setSubmitError(result.error);
      return;
    }
    // Clear the draft now, before navigating, and stop anything re-saving it.
    // The button stays disabled ("Creating...") until the page is hidden,
    // when the useLayoutEffect cleanup above resets the whole form.
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
    <Card ref={cardRef} className="scroll-mt-4">
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
            {templatesForChapter.length > 0 && (
              <div className="grid gap-2 rounded-md border border-dashed bg-muted/40 p-3">
                <Label htmlFor="create_template">
                  Start from a template{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Select
                  id="create_template"
                  value={form.templateId}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                >
                  <option value="">No template — start blank</option>
                  {templatesForChapter.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {!form.chapter && t.chapter ? ` (${t.chapter})` : ""}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">
                  A shortcut: pre-fills the event type, title, description, location, capacity,
                  registration sections, virtual details, and volunteer roles — whichever the
                  template has. Everything stays editable.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <ChapterField
                idPrefix="create"
                value={form.chapter}
                onChange={updateChapter}
                allowed={allowedChapters}
              />
              <EventTypeField
                idPrefix="create"
                value={form.eventType}
                onChange={updateEventType}
                eventTypes={eventTypes}
              />
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
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Date and time:</span> choose a
                chapter above first — it sets the time zone, then the date and time fields
                appear here.
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
                onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
                venues={venues}
                chapter={form.chapter}
                saveVenue={saveVenue}
                onSaveVenueChange={canSaveVenue ? setSaveVenue : undefined}
              />
            )}

            <DescriptionField
              idPrefix="create"
              value={form.description}
              onChange={setField("description")}
            />

            <OccurrenceNoteField
              idPrefix="create"
              value={form.occurrenceNote}
              onChange={setField("occurrenceNote")}
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
              leadUserId={form.leadUserId}
              onChangeLeadUserId={setField("leadUserId")}
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

            <RequiresHealthHistoryField
              idPrefix="create"
              checked={form.requiresHealthHistory}
              onChange={setField("requiresHealthHistory")}
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
                    <VolunteerRoleFields
                      idPrefix="create"
                      index={i}
                      role={role}
                      roleTypes={roleTypesForEvent(
                        roleTypes,
                        form.requiresHealthHistory,
                        new Set(role.roleTypeId ? [Number(role.roleTypeId)] : []),
                      )}
                      onChange={(field, value) => updateRole(i, field, value)}
                    />
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
                onChange={(e) => {
                  const recurrence = e.target.value as "none" | RecurrenceFrequency;
                  // A boost is one occurrence, never a series — see below.
                  setForm((prev) => ({
                    ...prev,
                    recurrence,
                    boostTier1: recurrence === "none" ? prev.boostTier1 : false,
                  }));
                }}
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

            {form.recurrence === "none" ? (
              <MarketingBoostField
                idPrefix="create"
                checked={form.boostTier1}
                onChange={setField("boostTier1")}
              />
            ) : (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Tier 1 marketing boost:</span> a
                boost is always one occurrence, never a whole series. Create the series first,
                then boost the occurrence you want from its edit page.
              </p>
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
                <>
                  <ReviewRow label="Location" value={composeLocation(formLocation(form)) ?? "—"} />
                  {saveVenue &&
                    canSaveVenue &&
                    !findVenueByName(venuesForChapter(venues, form.chapter), form.venueName) && (
                      <ReviewRow label="Saved venues" value={`"${form.venueName.trim()}" will be added for ${form.chapter}`} />
                    )}
                </>
              )}
              <ReviewRow label="About this event" value={form.description || "—"} />
              <ReviewRow label="What's different about this one" value={form.occurrenceNote.trim() || "—"} />
              <ReviewRow label="Capacity" value={form.capacity.trim() || "Unlimited"} />
              <ReviewRow
                label="Lead contact"
                value={[form.leadName, form.leadPhone, form.leadEmail].filter(Boolean).join(" · ") || "—"}
              />
              <ReviewRow label="Email-only note" value={form.customEmailNote.trim() || "—"} />
              <ReviewRow
                label="Requires health history"
                value={form.requiresHealthHistory ? "Yes" : "No"}
              />
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
              {templateEndFallbackRoles.length > 0 && (
                <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                  This event has no end time, so{" "}
                  {templateEndFallbackRoles.length === 1
                    ? `${templateEndFallbackRoles[0]}'s`
                    : `${templateEndFallbackRoles.join(", ")}'s`}{" "}
                  end time{templateEndFallbackRoles.length === 1 ? "" : "s"} fell back to event
                  start + offset instead of the template&apos;s event-end anchor — check{" "}
                  {templateEndFallbackRoles.length === 1 ? "it" : "them"} by hand, or add an end
                  time to the event.
                </p>
              )}
            </ReviewSection>

            <ReviewSection title="Recurrence and marketing" onEdit={() => goToStep(4)}>
              <ReviewRow
                label="Pattern"
                value={
                  form.recurrence === "none"
                    ? "One-time"
                    : `${form.recurrence}, through ${form.recurrenceEndDate}`
                }
              />
              <ReviewRow label="Occurrences" value={String(occurrenceDates.length)} />
              <ReviewRow
                label="Tier 1 marketing boost"
                value={form.recurrence === "none" && form.boostTier1 ? "Yes" : "No"}
              />
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
