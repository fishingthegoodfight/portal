import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPhoneNumber } from "@/lib/phone";

/** One emergency contact — name, phone, relationship — as the health form
 * and volunteer registration both collect it (the profile's two contacts). */
export function EmergencyContactFields({
  title,
  idPrefix,
  name,
  phone,
  relationship,
  onName,
  onPhone,
  onRelationship,
  required = false,
  relationshipOptional = false,
}: {
  title: string;
  idPrefix: string;
  name: string;
  phone: string;
  relationship: string;
  onName: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPhone: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRelationship: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Mark the inputs required, for forms that rely on the browser's check. */
  required?: boolean;
  /** With `required`: name and phone only, relationship optional (walk-up,
   * like the RSVP form) — said in the box's placeholder, not the label. */
  relationshipOptional?: boolean;
}) {
  // Three columns from `sm` up, which in a narrow dialog (the walk-up form)
  // leaves each about 120px: every label has to fit on one line, or that
  // column's box drops below the others. So the labels are single words
  // that never wrap, and `items-end` keeps the boxes level regardless.
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-semibold">{title}</legend>
      <div className="grid items-end gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor={`${idPrefix}_name`} className="whitespace-nowrap text-xs">Name</Label>
          <Input id={`${idPrefix}_name`} required={required} value={name} onChange={onName} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${idPrefix}_phone`} className="whitespace-nowrap text-xs">Phone</Label>
          <Input
            id={`${idPrefix}_phone`}
            type="tel"
            inputMode="numeric"
            maxLength={14}
            required={required}
            value={phone}
            onChange={onPhone}
            placeholder="(303) 555-0100"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${idPrefix}_rel`} className="whitespace-nowrap text-xs">Relationship</Label>
          <Input
            id={`${idPrefix}_rel`}
            required={required && !relationshipOptional}
            value={relationship}
            onChange={onRelationship}
            placeholder={relationshipOptional ? "Optional" : "e.g. Spouse"}
          />
        </div>
      </div>
    </fieldset>
  );
}

/**
 * The registration catalog's "Emergency contact" section
 * (lib/registration-sections.ts) as two EmergencyContactFields rows — one
 * contact per row, name, phone and relationship together — instead of the
 * generic two-column grid, which put "Relationship" beside "Second contact
 * name". Used wherever that section is filled in (the RSVP form, volunteer
 * shift signup, the profile page), so all of them match the walk-up form,
 * volunteer registration and the health form. Same rules as the catalog:
 * the first contact's name and phone are required, everything else optional.
 */
export function EmergencyContactSectionFields({
  values,
  onChange,
}: {
  /** Keyed by profile column, as every registration section's values are. */
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const text = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => onChange(key, e.target.value);
  const phone = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange(key, formatPhoneNumber(e.target.value));

  return (
    <div className="grid gap-4">
      <EmergencyContactFields
        title="Main contact"
        idPrefix="emergency_contact"
        required
        relationshipOptional
        name={values.emergency_contact ?? ""}
        phone={values.emergency_phone ?? ""}
        relationship={values.emergency_contact_relationship ?? ""}
        onName={text("emergency_contact")}
        onPhone={phone("emergency_phone")}
        onRelationship={text("emergency_contact_relationship")}
      />
      <EmergencyContactFields
        title="Second contact (optional)"
        idPrefix="emergency_contact_2"
        name={values.emergency_contact_2 ?? ""}
        phone={values.emergency_phone_2 ?? ""}
        relationship={values.emergency_contact_2_relationship ?? ""}
        onName={text("emergency_contact_2")}
        onPhone={phone("emergency_phone_2")}
        onRelationship={text("emergency_contact_2_relationship")}
      />
    </div>
  );
}
