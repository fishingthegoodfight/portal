"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EVENT_TYPES } from "@/lib/event-types";

/**
 * The plain text-ish event fields shared by the admin create wizard and edit
 * form — one definition each for markup, labels and rules, so the two forms
 * can't drift apart.
 */

export function TitleField({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={`${idPrefix}_title`}>Title</Label>
      <Input
        id={`${idPrefix}_title`}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function EventTypeField({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
}) {
  // An event created by hand can carry a type that isn't in the list; keep it
  // selectable so opening the edit form doesn't silently change it.
  const isLegacy = value !== "" && !EVENT_TYPES.includes(value as (typeof EVENT_TYPES)[number]);
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={`${idPrefix}_event_type`}>Event type</Label>
      <Select
        id={`${idPrefix}_event_type`}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select a type</option>
        {isLegacy && <option value={value}>{value}</option>}
        {EVENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function DescriptionField({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={`${idPrefix}_description`}>Public description</Label>
      <Textarea
        id={`${idPrefix}_description`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Blank means unlimited; otherwise at least 1 — the same rule on both forms
 * (see capacityError in lib/event-capacity.ts). */
export function CapacityField({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={`${idPrefix}_capacity`}>Capacity</Label>
      <Input
        id={`${idPrefix}_capacity`}
        type="number"
        inputMode="numeric"
        min={1}
        placeholder="Leave blank for unlimited"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function CustomEmailNoteField({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={`${idPrefix}_custom_note`}>Custom email note</Label>
      <Textarea
        id={`${idPrefix}_custom_note`}
        placeholder="Shown in the RSVP confirmation email, if set"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
