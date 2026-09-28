import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  /** With `required`: name and phone only, relationship labelled optional
   * (walk-up, like the RSVP form). */
  relationshipOptional?: boolean;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-semibold">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor={`${idPrefix}_name`} className="text-xs">Name</Label>
          <Input id={`${idPrefix}_name`} required={required} value={name} onChange={onName} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${idPrefix}_phone`} className="text-xs">Phone</Label>
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
          <Label htmlFor={`${idPrefix}_rel`} className="text-xs">
            {relationshipOptional ? "Relationship (optional)" : "Relationship"}
          </Label>
          <Input
            id={`${idPrefix}_rel`}
            required={required && !relationshipOptional}
            value={relationship}
            onChange={onRelationship}
            placeholder="e.g. Spouse"
          />
        </div>
      </div>
    </fieldset>
  );
}
