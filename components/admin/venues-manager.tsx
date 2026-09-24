"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  createVenueAction,
  deleteVenueAction,
  setVenueActiveAction,
  updateVenueAction,
  venueUsageAction,
  type VenueInput,
} from "@/lib/actions/venues";
import { CHAPTERS } from "@/lib/chapters";
import { EMPTY_LOCATION } from "@/lib/event-location";
import { venueAddressLine, type Venue } from "@/lib/venues";
import { ShowInactiveToggle, useDeleteFlow } from "@/components/admin/setup-list-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const EMPTY_INPUT: VenueInput = { ...EMPTY_LOCATION, chapter: "" };

function toInput(venue: Venue): VenueInput {
  return {
    venueName: venue.name,
    streetAddress: venue.street_address ?? "",
    city: venue.city ?? "",
    state: venue.state ?? "",
    postalCode: venue.postal_code ?? "",
    chapter: venue.chapter ?? "",
  };
}

function VenueFormFields({
  value,
  onChange,
  idPrefix,
}: {
  value: VenueInput;
  onChange: (next: VenueInput) => void;
  idPrefix: string;
}) {
  const text = (field: keyof VenueInput, label: string, extra: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-2">
      <Label htmlFor={`${idPrefix}_${field}`}>{label}</Label>
      <Input
        id={`${idPrefix}_${field}`}
        value={value[field]}
        onChange={(e) =>
          onChange({ ...value, [field]: field === "state" ? e.target.value.toUpperCase() : e.target.value })
        }
        {...extra}
      />
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-4">
        {text("venueName", "Name", { required: true })}
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}_chapter`}>Chapter</Label>
          <Select
            id={`${idPrefix}_chapter`}
            value={value.chapter}
            onChange={(e) => onChange({ ...value, chapter: e.target.value })}
          >
            <option value="">All chapters</option>
            {CHAPTERS.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}, {c.state}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {text("streetAddress", "Street address", { required: true })}
      <div className="grid grid-cols-3 gap-4">
        {text("city", "City", { required: true })}
        {text("state", "State", { required: true, maxLength: 2, placeholder: "CO" })}
        {text("postalCode", "ZIP code (optional)", { inputMode: "numeric", maxLength: 10 })}
      </div>
    </div>
  );
}

export function VenuesManager({ venues }: { venues: Venue[] }) {
  const router = useRouter();
  const [addInput, setAddInput] = useState<VenueInput>(EMPTY_INPUT);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editInput, setEditInput] = useState<VenueInput>(EMPTY_INPUT);
  const [editError, setEditError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const deleteFlow = useDeleteFlow({
    noun: "venue",
    hiddenWhenInactive: "hides it from the event forms' venue picker",
    checkUsage: venueUsageAction,
    remove: deleteVenueAction,
    deactivate: (id) => setVenueActiveAction(id, false),
    onDone: () => router.refresh(),
  });

  const visible = venues.filter((v) => showInactive || v.active);
  const inactiveCount = venues.length - venues.filter((v) => v.active).length;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    const result = await createVenueAction(addInput);
    setAdding(false);
    if (!result.ok) {
      setAddError(result.error);
      return;
    }
    setAddInput(EMPTY_INPUT);
    router.refresh();
  };

  const startEdit = (venue: Venue) => {
    setEditingId(venue.id);
    setEditInput(toInput(venue));
    setEditError(null);
  };

  const saveEdit = async (id: number) => {
    setBusyId(id);
    setEditError(null);
    const result = await updateVenueAction(id, editInput);
    setBusyId(null);
    if (!result.ok) {
      setEditError(result.error);
      return;
    }
    setEditingId(null);
    router.refresh();
  };

  const toggleActive = async (id: number, active: boolean) => {
    setBusyId(id);
    await setVenueActiveAction(id, active);
    setBusyId(null);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add venue</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-col gap-4">
            <VenueFormFields value={addInput} onChange={setAddInput} idPrefix="add_venue" />
            {addError && <p className="text-sm text-red-500">{addError}</p>}
            <div>
              <Button type="submit" disabled={adding}>
                {adding ? "Adding..." : "Add venue"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Venues</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ShowInactiveToggle
            id="venues_show_inactive"
            count={inactiveCount}
            checked={showInactive}
            onChange={setShowInactive}
          />
          {visible.map((venue) => (
            <div key={venue.id} className="rounded-md border p-3">
              {editingId === venue.id ? (
                <div className="flex flex-col gap-3">
                  <VenueFormFields value={editInput} onChange={setEditInput} idPrefix={`edit_venue_${venue.id}`} />
                  {editError && <p className="text-sm text-red-500">{editError}</p>}
                  <div className="flex gap-2">
                    <Button type="button" size="sm" disabled={busyId === venue.id} onClick={() => saveEdit(venue.id)}>
                      Save
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{venue.name}</span>
                      {!venue.active && <Badge variant="secondary">Inactive</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">{venueAddressLine(venue)}</p>
                    <p className="text-sm text-muted-foreground">{venue.chapter ?? "All chapters"}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => startEdit(venue)}>
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busyId === venue.id}
                      onClick={() => toggleActive(venue.id, !venue.active)}
                    >
                      {venue.active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busyId === venue.id || deleteFlow.isBusy(venue.id)}
                      onClick={() => deleteFlow.begin({ id: venue.id, name: venue.name, active: venue.active })}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              )}
              {deleteFlow.panelFor(venue.id)}
            </div>
          ))}
          {venues.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No saved venues yet. Add one above, or tick &ldquo;Save this venue for next
              time&rdquo; when creating an event.
            </p>
          )}
          {venues.length > 0 && visible.length === 0 && (
            <p className="text-sm text-muted-foreground">All venues are inactive.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
