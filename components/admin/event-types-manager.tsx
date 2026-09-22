"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";

import {
  createEventTypeAction,
  reorderEventTypesAction,
  setEventTypeActiveAction,
  updateEventTypeAction,
  type EventTypeInput,
} from "@/lib/actions/event-types";
import type { EventTypeOption } from "@/lib/event-types";
import { RegistrationSectionsFields } from "@/components/admin/fields/registration-sections-fields";
import { REGISTRATION_SECTIONS } from "@/lib/registration-sections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EMPTY_INPUT: EventTypeInput = { name: "", defaultRegistrationSections: [] };

function toInput(type: EventTypeOption): EventTypeInput {
  return { name: type.name, defaultRegistrationSections: type.default_registration_sections };
}

function sectionsLabel(ids: string[]): string {
  const set = new Set(ids);
  const labels = REGISTRATION_SECTIONS.filter((s) => set.has(s.id)).map((s) => s.title);
  return labels.length > 0 ? labels.join(", ") : "None";
}

function EventTypeFields({
  value,
  onChange,
  idPrefix,
}: {
  value: EventTypeInput;
  onChange: (next: EventTypeInput) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}_name`}>Name</Label>
        <Input
          id={`${idPrefix}_name`}
          required
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </div>
      <RegistrationSectionsFields
        idPrefix={idPrefix}
        selected={value.defaultRegistrationSections}
        onToggle={(sectionId, checked) =>
          onChange({
            ...value,
            defaultRegistrationSections: checked
              ? [...value.defaultRegistrationSections, sectionId]
              : value.defaultRegistrationSections.filter((id) => id !== sectionId),
          })
        }
      />
    </div>
  );
}

export function EventTypesManager({ eventTypes }: { eventTypes: EventTypeOption[] }) {
  const router = useRouter();
  const [addInput, setAddInput] = useState<EventTypeInput>(EMPTY_INPUT);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editInput, setEditInput] = useState<EventTypeInput>(EMPTY_INPUT);
  const [editError, setEditError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const sorted = [...eventTypes].sort((a, b) => a.sort_order - b.sort_order);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    const result = await createEventTypeAction(addInput);
    setAdding(false);
    if (!result.ok) {
      setAddError(result.error);
      return;
    }
    setAddInput(EMPTY_INPUT);
    router.refresh();
  };

  const startEdit = (type: EventTypeOption) => {
    setEditingId(type.id);
    setEditInput(toInput(type));
    setEditError(null);
  };

  const saveEdit = async (id: number) => {
    setBusyId(id);
    setEditError(null);
    const result = await updateEventTypeAction(id, editInput);
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
    await setEventTypeActiveAction(id, active);
    setBusyId(null);
    router.refresh();
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    const reordered = [...sorted];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setBusyId(reordered[index].id);
    await reorderEventTypesAction(reordered.map((t) => t.id));
    setBusyId(null);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add event type</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-col gap-4">
            <EventTypeFields value={addInput} onChange={setAddInput} idPrefix="add_type" />
            {addError && <p className="text-sm text-red-500">{addError}</p>}
            <div>
              <Button type="submit" disabled={adding}>
                {adding ? "Adding..." : "Add event type"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Event types</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {sorted.map((type, i) => (
            <div key={type.id} className="rounded-md border p-3">
              {editingId === type.id ? (
                <div className="flex flex-col gap-3">
                  <EventTypeFields value={editInput} onChange={setEditInput} idPrefix={`edit_${type.id}`} />
                  {editError && <p className="text-sm text-red-500">{editError}</p>}
                  <div className="flex gap-2">
                    <Button type="button" size="sm" disabled={busyId === type.id} onClick={() => saveEdit(type.id)}>
                      Save
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{type.name}</span>
                      {!type.active && <Badge variant="secondary">Inactive</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Default sections: {sectionsLabel(type.default_registration_sections)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={i === 0 || busyId === type.id}
                        onClick={() => move(i, -1)}
                        aria-label="Move up"
                      >
                        <ChevronUp className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={i === sorted.length - 1 || busyId === type.id}
                        onClick={() => move(i, 1)}
                        aria-label="Move down"
                      >
                        <ChevronDown className="size-4" />
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => startEdit(type)}>
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busyId === type.id}
                        onClick={() => toggleActive(type.id, !type.active)}
                      >
                        {type.active ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
