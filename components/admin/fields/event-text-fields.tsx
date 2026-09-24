"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { EventTypeOption } from "@/lib/event-types";

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
      <Label htmlFor={`${idPrefix}_title`}>Event title</Label>
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
  eventTypes,
}: {
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
  /** From the `event_types` table (lib/event-types.ts) — the create wizard
   * passes active-only rows, the edit form passes every row (active and
   * inactive) so an event that already has a deactivated type still shows
   * it correctly. */
  eventTypes: EventTypeOption[];
}) {
  // An event's stored type can predate event_types entirely, or be a value
  // that's since been renamed — keep it selectable either way, so opening
  // the edit form never silently changes it.
  const isLegacy = value !== "" && !eventTypes.some((t) => t.name === value);
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
        {[...eventTypes]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((t) => (
            <option key={t.id} value={t.name}>
              {t.name}
              {!t.active ? " (inactive)" : ""}
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
      <Label htmlFor={`${idPrefix}_description`}>About this event</Label>
      <Textarea
        id={`${idPrefix}_description`}
        aria-describedby={`${idPrefix}_description_help`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${idPrefix}_description_help`} className="text-xs text-muted-foreground">
        A standing description of what this program is, shown on the event page and the public
        link. It&apos;s reused every time you run this event, so keep it general — no dates or
        one-off details.
      </p>
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
      <Label htmlFor={`${idPrefix}_custom_note`}>Email-only note (optional)</Label>
      <Textarea
        id={`${idPrefix}_custom_note`}
        aria-describedby={`${idPrefix}_custom_note_help`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${idPrefix}_custom_note_help`} className="text-xs text-muted-foreground">
        Only in the confirmation and reminder emails to people who registered — never shown on
        the site or the public link. Good for logistics you&apos;d rather not post, like a door
        code or where to park.
      </p>
    </div>
  );
}

/**
 * A short public note for this specific occurrence — e.g. "Tonight we're
 * tying a Pat's Rubber Legs." Distinct from CustomEmailNoteField above
 * (email-only) and from DescriptionField (the event's standing description):
 * this shows on the site (events list, event page) as well as in the
 * confirmation and reminder emails, and is never pre-filled by a template.
 */
export function OccurrenceNoteField({
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
      <Label htmlFor={`${idPrefix}_occurrence_note`}>
        What&apos;s different about this one? (optional)
      </Label>
      <Textarea
        id={`${idPrefix}_occurrence_note`}
        aria-describedby={`${idPrefix}_occurrence_note_help`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${idPrefix}_occurrence_note_help`} className="text-xs text-muted-foreground">
        A short public note about this specific date. Appears under the description and in
        confirmation and reminder emails. Example: &ldquo;This month we&apos;re tying a Pat&apos;s
        Rubber Legs.&rdquo;
      </p>
    </div>
  );
}
