"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { updateEventAction, type EventEditInput } from "@/lib/actions/admin-event";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TIMEZONE_OPTIONS } from "@/lib/chapters";
import { formatPhoneNumber } from "@/lib/phone";
import { REGISTRATION_SECTIONS } from "@/lib/registration-sections";

// Always-required sections (e.g. emergency contact) apply to every event
// regardless — only optional ones are worth exposing as a per-event choice.
const OPTIONAL_SECTIONS = REGISTRATION_SECTIONS.filter((s) => !s.alwaysRequired);

export function EventEditForm({
  eventId,
  initial,
  isCancelled,
}: {
  eventId: number;
  initial: EventEditInput;
  isCancelled: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<EventEditInput>(initial);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [notifyPrompt, setNotifyPrompt] = useState<{ confirmedCount: number } | null>(null);

  const updateField =
    (field: keyof Omit<EventEditInput, "registrationSections">) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const updateLeadPhone = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, leadPhone: formatPhoneNumber(e.target.value) }));

  const toggleSection = (sectionId: string, checked: boolean) =>
    setForm((prev) => ({
      ...prev,
      registrationSections: checked
        ? [...prev.registrationSections, sectionId]
        : prev.registrationSections.filter((id) => id !== sectionId),
    }));

  const save = async (notifyAttendees: boolean | null) => {
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
    const result = await updateEventAction(eventId, form, notifyAttendees);

    setIsSaving(false);

    if (!result.ok) {
      setError(result.error);
      setNotifyPrompt(null);
      return;
    }
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
            <div className="grid gap-2">
              <Label htmlFor="edit_location">Location</Label>
              <Input id="edit_location" value={form.location} onChange={updateField("location")} />
            </div>
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

            <div className="grid grid-cols-2 gap-4 rounded-md border p-3">
              <div className="col-span-2 text-sm font-medium">When</div>
              <div className="grid gap-2">
                <Label htmlFor="edit_date">Date</Label>
                <Input
                  id="edit_date"
                  type="date"
                  required
                  value={form.date}
                  onChange={updateField("date")}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_timezone">Time zone</Label>
                <Select
                  id="edit_timezone"
                  required
                  value={form.timezone}
                  onChange={updateField("timezone")}
                >
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_time">Start time</Label>
                <Input
                  id="edit_time"
                  type="time"
                  required
                  value={form.time}
                  onChange={updateField("time")}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_end_time">End time</Label>
                <Input
                  id="edit_end_time"
                  type="time"
                  placeholder="Optional"
                  value={form.endTime}
                  onChange={updateField("endTime")}
                />
                <span className="text-xs text-muted-foreground">
                  Leave blank for an open-ended event.
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit_lead_name">Lead name</Label>
                <Input
                  id="edit_lead_name"
                  placeholder="Day-of contact"
                  value={form.leadName}
                  onChange={updateField("leadName")}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_lead_phone">Lead phone</Label>
                <Input
                  id="edit_lead_phone"
                  type="tel"
                  inputMode="numeric"
                  placeholder="(303) 555-0100"
                  maxLength={14}
                  value={form.leadPhone}
                  onChange={updateLeadPhone}
                />
              </div>
              <div className="grid gap-2 col-span-2">
                <Label htmlFor="edit_lead_email">Lead email</Label>
                <Input
                  id="edit_lead_email"
                  type="email"
                  value={form.leadEmail}
                  onChange={updateField("leadEmail")}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit_custom_note">Custom email note</Label>
              <Textarea
                id="edit_custom_note"
                placeholder="Shown in the RSVP confirmation email, if set"
                value={form.customEmailNote}
                onChange={updateField("customEmailNote")}
              />
            </div>

            {OPTIONAL_SECTIONS.length > 0 && (
              <div className="grid gap-2">
                <span className="text-sm font-medium">Registration sections</span>
                {OPTIONAL_SECTIONS.map((section) => (
                  <label
                    key={section.id}
                    className="flex items-center gap-2 text-sm"
                    htmlFor={`edit_section_${section.id}`}
                  >
                    <Checkbox
                      id={`edit_section_${section.id}`}
                      checked={form.registrationSections.includes(section.id)}
                      onCheckedChange={(checked) => toggleSection(section.id, checked === true)}
                    />
                    {section.title}
                  </label>
                ))}
              </div>
            )}

            {notifyPrompt && (
              <div className="flex flex-col gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  This changes the date, time, or location for{" "}
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
            {!notifyPrompt && (
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
