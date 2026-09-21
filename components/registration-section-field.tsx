"use client";

import Link from "next/link";

import { RegistrationFieldInput } from "@/components/registration-fields";
import {
  isSectionComplete,
  visibleFields,
  type RegistrationSection,
} from "@/lib/registration-sections";

/**
 * One registration section as collected on the RSVP form and the admin
 * walk-up form: the read-only "On file: …" line when the profile already has
 * it, otherwise the catalog-driven inputs (with conditional fields shown or
 * hidden). Shared so the two forms can't drift apart.
 */
export function RegistrationSectionField({
  section,
  profileFields,
  fieldValues,
  onChange,
  editProfileHref,
  requiredNote = "Required to RSVP — none on file yet.",
}: {
  section: RegistrationSection;
  /** The profile's values as loaded (empty for someone with no profile yet). */
  profileFields: Record<string, string>;
  fieldValues: Record<string, string>;
  onChange: (key: string, value: string) => void;
  /** Where "Edit on profile" goes; omit to show no edit link (the walk-up
   * form, where an admin isn't editing the person's own profile). */
  editProfileHref?: string;
  requiredNote?: string;
}) {
  // "On file" is based on the profile as loaded, not live edits — otherwise
  // finishing the last field of a section would make it flip to the
  // read-only summary mid-fill.
  const complete = !section.alwaysEditable && isSectionComplete(section, profileFields);
  const fields = visibleFields(section, fieldValues);
  const hasRequiredField = fields.some((field) => field.required);

  return (
    <div className="grid gap-1 rounded-md border p-3">
      <span className="text-sm font-medium">{section.title}</span>
      {complete ? (
        <span className="text-sm text-muted-foreground">
          On file: {section.summary(profileFields)}.
          {editProfileHref && (
            <>
              {" "}
              <Link
                // Deep-link straight to this section's card on the profile
                // page, which opens it (see profile-form.tsx).
                href={`${editProfileHref}#${section.id}`}
                className="underline underline-offset-4"
              >
                Edit on profile
              </Link>
            </>
          )}
        </span>
      ) : (
        <>
          {hasRequiredField && <span className="mb-1 text-sm text-amber-600">{requiredNote}</span>}
          <div
            className={
              fields.length > 1 && section.layout !== "stack"
                ? "grid grid-cols-2 gap-4"
                : "grid gap-3"
            }
          >
            {fields.map((field) => (
              <RegistrationFieldInput
                key={field.key}
                field={field}
                value={fieldValues[field.key] ?? ""}
                onChange={onChange}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
