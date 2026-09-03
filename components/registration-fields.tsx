"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DIETARY_NONE, type RegistrationField } from "@/lib/registration-sections";

/**
 * Renders a single registration field's input, generic across every type in
 * the catalog (lib/registration-sections.ts). Shared by the RSVP form and
 * the profile page so a new field type or section only needs handling here
 * once.
 */
export function RegistrationFieldInput({
  field,
  value,
  onChange,
}: {
  field: RegistrationField;
  value: string;
  onChange: (key: string, value: string) => void;
}) {
  if (field.type === "yesno") {
    return <YesNoNotesField field={field} value={value} onChange={onChange} />;
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={field.key}>{field.label}</Label>
      {field.type === "textarea" ? (
        <Textarea
          id={field.key}
          placeholder={field.placeholder}
          required={field.required}
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      ) : (
        <Input
          id={field.key}
          type={field.type === "tel" ? "tel" : "text"}
          inputMode={field.type === "tel" ? "numeric" : undefined}
          placeholder={field.placeholder}
          maxLength={field.type === "tel" ? 14 : undefined}
          required={field.required}
          value={value}
          onChange={(e) =>
            onChange(
              field.key,
              field.format ? field.format(e.target.value) : e.target.value,
            )
          }
        />
      )}
    </div>
  );
}

/**
 * A "Yes / No" radio backed by a single free-text column: "No" stores the
 * DIETARY_NONE sentinel, "Yes" reveals a required notes box whose text is the
 * stored value. An empty stored value means "not answered yet".
 */
function YesNoNotesField({
  field,
  value,
  onChange,
}: {
  field: RegistrationField;
  value: string;
  onChange: (key: string, value: string) => void;
}) {
  const trimmed = value.trim();
  const [choice, setChoice] = useState<"yes" | "no" | "">(
    trimmed === "" ? "" : trimmed === DIETARY_NONE ? "no" : "yes",
  );

  const pick = (next: "yes" | "no") => {
    setChoice(next);
    // "Yes" clears the column back to empty so the notes box starts blank and
    // any required-field check holds until something is typed.
    onChange(field.key, next === "no" ? DIETARY_NONE : "");
  };

  return (
    <div className="grid gap-2">
      <div className="flex gap-6 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={field.key}
            checked={choice === "yes"}
            onChange={() => pick("yes")}
          />
          Yes
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={field.key}
            checked={choice === "no"}
            onChange={() => pick("no")}
          />
          No
        </label>
      </div>
      {choice === "yes" && (
        <div className="grid gap-2">
          <Label htmlFor={field.key}>{field.label}</Label>
          <Textarea
            id={field.key}
            placeholder={field.placeholder}
            required
            value={value === DIETARY_NONE ? "" : value}
            onChange={(e) => onChange(field.key, e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
