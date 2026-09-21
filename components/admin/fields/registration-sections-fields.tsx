"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { EVENT_LEVEL_OPTIONAL_SECTIONS } from "@/lib/registration-sections";

// Always-required sections (e.g. emergency contact) apply to every event
// regardless, and profile-only ones (participant directory) are standing
// preferences — only optional event-level ones are a per-event choice.
export const OPTIONAL_REGISTRATION_SECTIONS = EVENT_LEVEL_OPTIONAL_SECTIONS;

/**
 * The optional-registration-sections checkbox list, shared by the admin
 * event create and edit forms.
 */
export function RegistrationSectionsFields({
  idPrefix,
  selected,
  onToggle,
}: {
  idPrefix: string;
  selected: string[];
  onToggle: (sectionId: string, checked: boolean) => void;
}) {
  if (OPTIONAL_REGISTRATION_SECTIONS.length === 0) return null;

  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">Registration sections</span>
      {OPTIONAL_REGISTRATION_SECTIONS.map((section) => (
        <label
          key={section.id}
          className="flex items-center gap-2 text-sm"
          htmlFor={`${idPrefix}_section_${section.id}`}
        >
          <Checkbox
            id={`${idPrefix}_section_${section.id}`}
            checked={selected.includes(section.id)}
            onCheckedChange={(checked) => onToggle(section.id, checked === true)}
          />
          {section.title}
        </label>
      ))}
    </div>
  );
}
