"use client";

import { VenueField } from "@/components/admin/fields/venue-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LocationFieldsValue } from "@/lib/event-location";
import { venueToLocation, type Venue } from "@/lib/venues";

/**
 * Venue name, street address, city, state and ZIP — shared by the admin
 * event create wizard, the edit form and event templates so they can't
 * drift apart. Venue name is a picker of saved venues (VenueField) that
 * fills in the rest; everything stays editable.
 */
export function LocationFields({
  idPrefix,
  value,
  onChange,
  required = true,
  legacyLocation,
  venues,
  chapter,
  saveVenue,
  onSaveVenueChange,
}: {
  idPrefix: string;
  value: LocationFieldsValue;
  /** Called with just the fields that changed — all of them at once when a
   * saved venue is picked. */
  onChange: (patch: Partial<LocationFieldsValue>) => void;
  required?: boolean;
  /** An older event's free-text location, shown while the structured fields
   * are still empty so it isn't silently lost. */
  legacyLocation?: string | null;
  /** Active saved venues offered by the venue picker. */
  venues: Venue[];
  /** The event's (or template's) chapter — scopes the picker. */
  chapter: string;
  saveVenue?: boolean;
  /** Omit to never offer "Save this venue for next time". */
  onSaveVenueChange?: (save: boolean) => void;
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
      <VenueField
        idPrefix={idPrefix}
        value={value.venueName}
        required={required}
        venues={venues}
        chapter={chapter}
        onChangeName={(venueName) => onChange({ venueName })}
        onPick={(venue) => onChange(venueToLocation(venue))}
        saveVenue={saveVenue}
        onSaveVenueChange={onSaveVenueChange}
      />
      <div className="grid gap-2 col-span-2">
        <Label htmlFor={`${idPrefix}_street`}>Street address</Label>
        <Input
          id={`${idPrefix}_street`}
          required={required}
          value={value.streetAddress}
          onChange={(e) => onChange({ streetAddress: e.target.value })}
        />
      </div>
      <div className="grid gap-2 col-span-2">
        <Label htmlFor={`${idPrefix}_city`}>City</Label>
        <Input
          id={`${idPrefix}_city`}
          required={required}
          value={value.city}
          onChange={(e) => onChange({ city: e.target.value })}
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
          onChange={(e) => onChange({ state: e.target.value.toUpperCase() })}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}_postal_code`}>
          ZIP code <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={`${idPrefix}_postal_code`}
          inputMode="numeric"
          autoComplete="off"
          maxLength={10}
          placeholder="80202"
          value={value.postalCode}
          onChange={(e) => onChange({ postalCode: e.target.value })}
        />
      </div>
    </div>
  );
}
