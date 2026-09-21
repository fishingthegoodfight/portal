"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LocationFieldsValue } from "@/lib/event-location";

/**
 * Venue name, street address, city and state — shared by the admin event
 * create wizard and the edit form so the two can't drift apart.
 */
export function LocationFields({
  idPrefix,
  value,
  onChange,
  required = true,
  legacyLocation,
}: {
  idPrefix: string;
  value: LocationFieldsValue;
  onChange: (field: keyof LocationFieldsValue, value: string) => void;
  required?: boolean;
  /** An older event's free-text location, shown while the structured fields
   * are still empty so it isn't silently lost. */
  legacyLocation?: string | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 rounded-md border p-3">
      <div className="col-span-2 text-sm font-medium">Location</div>
      {legacyLocation && (
        <p className="col-span-2 text-sm text-muted-foreground">
          Current location: {legacyLocation}. Fill in the fields below to replace it with a
          structured address, or leave them empty to keep it.
        </p>
      )}
      <div className="grid gap-2 col-span-2">
        <Label htmlFor={`${idPrefix}_venue`}>Venue name</Label>
        <Input
          id={`${idPrefix}_venue`}
          required={required}
          value={value.venueName}
          onChange={(e) => onChange("venueName", e.target.value)}
        />
      </div>
      <div className="grid gap-2 col-span-2">
        <Label htmlFor={`${idPrefix}_street`}>Street address</Label>
        <Input
          id={`${idPrefix}_street`}
          required={required}
          value={value.streetAddress}
          onChange={(e) => onChange("streetAddress", e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}_city`}>City</Label>
        <Input
          id={`${idPrefix}_city`}
          required={required}
          value={value.city}
          onChange={(e) => onChange("city", e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}_state`}>State</Label>
        <Input
          id={`${idPrefix}_state`}
          required={required}
          maxLength={2}
          placeholder="CO"
          value={value.state}
          onChange={(e) => onChange("state", e.target.value.toUpperCase())}
        />
      </div>
    </div>
  );
}
