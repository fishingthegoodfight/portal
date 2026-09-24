"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  createTemplateAction,
  deleteTemplateAction,
  setTemplateActiveAction,
  templateUsageAction,
  updateTemplateAction,
  type TemplateInput,
  type TemplateRoleInput,
} from "@/lib/actions/event-templates";
import { templateLocation, type EventTemplateWithRoles, type ShiftAnchor } from "@/lib/event-templates";
import { EMPTY_LOCATION } from "@/lib/event-location";
import { isVirtualChapter } from "@/lib/chapters";
import type { Venue } from "@/lib/venues";
import { LocationFields } from "@/components/admin/fields/location-fields";
import type { EventTypeOption } from "@/lib/event-types";
import { CHAPTERS, VIRTUAL_CHAPTER } from "@/lib/chapters";
import { DescriptionField, EventTypeField } from "@/components/admin/fields/event-text-fields";
import { RoleDescriptionField } from "@/components/admin/fields/volunteer-role-fields";
import { RegistrationSectionsFields } from "@/components/admin/fields/registration-sections-fields";
import { REGISTRATION_SECTIONS } from "@/lib/registration-sections";
import { ShowInactiveToggle, useDeleteFlow } from "@/components/admin/setup-list-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export type TemplateRoleTypeOption = { id: number; name: string };

const EMPTY_ROLE: TemplateRoleInput = {
  roleTypeId: "",
  title: "",
  description: "",
  whatToBring: "",
  // Setup begins before doors, cleanup ends after the event — the common
  // case per role, and independently overridable per boundary.
  shiftStartAnchor: "event_start",
  shiftStartOffset: "0",
  shiftEndAnchor: "event_end",
  shiftEndOffset: "0",
  numberNeeded: "1",
};

const EMPTY_TEMPLATE: TemplateInput = {
  name: "",
  defaultTitle: "",
  eventType: "",
  chapter: "",
  description: "",
  defaultCapacity: "",
  defaultRegistrationSections: [],
  defaultVirtualLink: "",
  defaultVirtualAccessNotes: "",
  defaultLocation: EMPTY_LOCATION,
  roles: [],
};

function toInput(template: EventTemplateWithRoles): TemplateInput {
  return {
    name: template.name,
    defaultTitle: template.default_title ?? "",
    eventType: template.event_type,
    chapter: template.chapter ?? "",
    description: template.description ?? "",
    defaultCapacity: template.default_capacity != null ? String(template.default_capacity) : "",
    defaultRegistrationSections: template.default_registration_sections,
    defaultVirtualLink: template.default_virtual_link ?? "",
    defaultVirtualAccessNotes: template.default_virtual_access_notes ?? "",
    defaultLocation: templateLocation(template),
    roles: template.roles
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((r) => ({
        roleTypeId: String(r.role_type_id),
        title: r.title ?? "",
        description: r.description ?? "",
        whatToBring: r.what_to_bring ?? "",
        shiftStartAnchor: r.shift_start_anchor,
        shiftStartOffset: String(r.shift_start_offset),
        shiftEndAnchor: r.shift_end_anchor,
        shiftEndOffset: String(r.shift_end_offset),
        numberNeeded: String(r.number_needed),
      })),
  };
}

function sectionsLabel(ids: string[]): string {
  const set = new Set(ids);
  const labels = REGISTRATION_SECTIONS.filter((s) => set.has(s.id)).map((s) => s.title);
  return labels.length > 0 ? labels.join(", ") : "None";
}

const ANCHOR_LABEL: Record<ShiftAnchor, string> = {
  event_start: "event start",
  event_end: "event end",
};

/**
 * "Starts [30] minutes [before] [event start]" — a magnitude + direction +
 * anchor picker, rather than making the admin think in signed minutes. The
 * underlying value stays a signed offset (negative = before, positive =
 * after its anchor); this just presents/edits it as three plain parts.
 */
function ShiftOffsetField({
  idPrefix,
  label,
  anchor,
  offset,
  onChangeAnchor,
  onChangeOffset,
}: {
  idPrefix: string;
  label: string;
  anchor: ShiftAnchor;
  /** Signed minutes, as form text. */
  offset: string;
  onChangeAnchor: (anchor: ShiftAnchor) => void;
  onChangeOffset: (offset: string) => void;
}) {
  const magnitude = Math.abs(Number(offset) || 0);
  const direction: "before" | "after" = Number(offset) < 0 ? "before" : "after";

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-12 shrink-0 font-medium">{label}</span>
      <Input
        id={`${idPrefix}_magnitude`}
        type="number"
        inputMode="numeric"
        min={0}
        className="w-20"
        value={String(magnitude)}
        onChange={(e) => {
          const m = Math.max(0, Math.round(Number(e.target.value) || 0));
          onChangeOffset(String(direction === "before" ? -m : m));
        }}
      />
      <span>minutes</span>
      <Select
        id={`${idPrefix}_direction`}
        className="w-24"
        value={direction}
        onChange={(e) => {
          const nextDirection = e.target.value as "before" | "after";
          onChangeOffset(String(nextDirection === "before" ? -magnitude : magnitude));
        }}
      >
        <option value="before">before</option>
        <option value="after">after</option>
      </Select>
      <Select
        id={`${idPrefix}_anchor`}
        className="w-36"
        value={anchor}
        onChange={(e) => onChangeAnchor(e.target.value as ShiftAnchor)}
      >
        {(Object.keys(ANCHOR_LABEL) as ShiftAnchor[]).map((a) => (
          <option key={a} value={a}>
            {ANCHOR_LABEL[a]}
          </option>
        ))}
      </Select>
    </div>
  );
}

function TemplateRoleFields({
  role,
  roleTypes,
  onChange,
  onRemove,
  idPrefix,
}: {
  role: TemplateRoleInput;
  roleTypes: TemplateRoleTypeOption[];
  onChange: (next: TemplateRoleInput) => void;
  onRemove: () => void;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div className="grid flex-1 gap-2">
          <Label htmlFor={`${idPrefix}_role_type`}>Role type</Label>
          <Select
            id={`${idPrefix}_role_type`}
            required
            value={role.roleTypeId}
            onChange={(e) => onChange({ ...role, roleTypeId: e.target.value })}
          >
            <option value="">Choose a role type</option>
            {roleTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} className="ml-2 mt-6">
          Remove
        </Button>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}_title`}>
          Title <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={`${idPrefix}_title`}
          aria-describedby={`${idPrefix}_title_help`}
          placeholder={
            roleTypes.find((rt) => String(rt.id) === role.roleTypeId)?.name ??
            "Choose a role type first"
          }
          value={role.title}
          onChange={(e) => onChange({ ...role, title: e.target.value })}
        />
        <p id={`${idPrefix}_title_help`} className="text-xs text-muted-foreground">
          Leave blank to use the role type&apos;s name, or give it a friendlier label for this
          template. Display only — the role type still decides who can sign up.
        </p>
      </div>
      <RoleDescriptionField
        id={`${idPrefix}_description`}
        value={role.description}
        onChange={(description) => onChange({ ...role, description })}
      />
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}_bring`}>What to bring or wear</Label>
        <Input
          id={`${idPrefix}_bring`}
          placeholder="Optional — standard for this program, e.g. closed-toe shoes"
          value={role.whatToBring}
          onChange={(e) => onChange({ ...role, whatToBring: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <ShiftOffsetField
          idPrefix={`${idPrefix}_shift_start`}
          label="Starts"
          anchor={role.shiftStartAnchor}
          offset={role.shiftStartOffset}
          onChangeAnchor={(shiftStartAnchor) => onChange({ ...role, shiftStartAnchor })}
          onChangeOffset={(shiftStartOffset) => onChange({ ...role, shiftStartOffset })}
        />
        <ShiftOffsetField
          idPrefix={`${idPrefix}_shift_end`}
          label="Ends"
          anchor={role.shiftEndAnchor}
          offset={role.shiftEndOffset}
          onChangeAnchor={(shiftEndAnchor) => onChange({ ...role, shiftEndAnchor })}
          onChangeOffset={(shiftEndOffset) => onChange({ ...role, shiftEndOffset })}
        />
      </div>
      <div className="grid w-32 gap-2">
        <Label htmlFor={`${idPrefix}_needed`}>Number needed</Label>
        <Input
          id={`${idPrefix}_needed`}
          type="number"
          inputMode="numeric"
          min={1}
          required
          value={role.numberNeeded}
          onChange={(e) => onChange({ ...role, numberNeeded: e.target.value })}
        />
      </div>
    </div>
  );
}

function TemplateFormFields({
  value,
  onChange,
  roleTypes,
  eventTypes,
  venues,
  idPrefix,
}: {
  value: TemplateInput;
  onChange: (next: TemplateInput) => void;
  roleTypes: TemplateRoleTypeOption[];
  eventTypes: EventTypeOption[];
  venues: Venue[];
  idPrefix: string;
}) {
  const addRole = () => onChange({ ...value, roles: [...value.roles, { ...EMPTY_ROLE }] });
  const removeRole = (i: number) =>
    onChange({ ...value, roles: value.roles.filter((_, ri) => ri !== i) });
  const updateRole = (i: number, next: TemplateRoleInput) =>
    onChange({ ...value, roles: value.roles.map((r, ri) => (ri === i ? next : r)) });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}_name`}>Template name</Label>
        <Input
          id={`${idPrefix}_name`}
          required
          placeholder="e.g. Standard Fish A-Long"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}_default_title`}>
          Event title <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={`${idPrefix}_default_title`}
          aria-describedby={`${idPrefix}_default_title_help`}
          placeholder="e.g. Fish A-Long at Clear Creek"
          value={value.defaultTitle}
          onChange={(e) => onChange({ ...value, defaultTitle: e.target.value })}
        />
        <p id={`${idPrefix}_default_title_help`} className="text-xs text-muted-foreground">
          Pre-fills the new event&apos;s title, which stays editable. Leave blank to have the
          title start empty.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <EventTypeField
          idPrefix={idPrefix}
          value={value.eventType}
          onChange={(v) => onChange({ ...value, eventType: v })}
          eventTypes={eventTypes}
        />
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
            <option value={VIRTUAL_CHAPTER}>{VIRTUAL_CHAPTER}</option>
          </Select>
        </div>
      </div>
      <DescriptionField
        idPrefix={idPrefix}
        value={value.description}
        onChange={(description) => onChange({ ...value, description })}
      />
      {!isVirtualChapter(value.chapter) && (
        <div className="flex flex-col gap-1">
          <LocationFields
            idPrefix={`${idPrefix}_location`}
            value={value.defaultLocation}
            onChange={(patch) =>
              onChange({ ...value, defaultLocation: { ...value.defaultLocation, ...patch } })
            }
            required={false}
            venues={venues}
            chapter={value.chapter}
          />
          <p className="text-xs text-muted-foreground">
            Optional default location — pre-fills the event&apos;s address, which stays editable.
          </p>
        </div>
      )}
      <div className="grid grid-cols-3 gap-4">
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}_capacity`}>Default capacity</Label>
          <Input
            id={`${idPrefix}_capacity`}
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="Unlimited"
            value={value.defaultCapacity}
            onChange={(e) => onChange({ ...value, defaultCapacity: e.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}_virtual_link`}>Default meeting link</Label>
          <Input
            id={`${idPrefix}_virtual_link`}
            type="url"
            placeholder="Optional"
            value={value.defaultVirtualLink}
            onChange={(e) => onChange({ ...value, defaultVirtualLink: e.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}_virtual_notes`}>Default access notes</Label>
          <Input
            id={`${idPrefix}_virtual_notes`}
            placeholder="Optional"
            value={value.defaultVirtualAccessNotes}
            onChange={(e) => onChange({ ...value, defaultVirtualAccessNotes: e.target.value })}
          />
        </div>
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
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium">Volunteer roles</span>
        {value.roles.map((role, i) => (
          <TemplateRoleFields
            key={i}
            role={role}
            roleTypes={roleTypes}
            onChange={(next) => updateRole(i, next)}
            onRemove={() => removeRole(i)}
            idPrefix={`${idPrefix}_role_${i}`}
          />
        ))}
        <Button type="button" variant="outline" onClick={addRole} className="w-fit">
          Add role
        </Button>
      </div>
    </div>
  );
}

export function EventTemplatesManager({
  templates,
  roleTypes,
  eventTypes,
  venues,
}: {
  templates: EventTemplateWithRoles[];
  roleTypes: TemplateRoleTypeOption[];
  eventTypes: EventTypeOption[];
  /** Active saved venues, for the default-location picker. */
  venues: Venue[];
}) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [addInput, setAddInput] = useState<TemplateInput>(EMPTY_TEMPLATE);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editInput, setEditInput] = useState<TemplateInput>(EMPTY_TEMPLATE);
  const [editError, setEditError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const deleteFlow = useDeleteFlow({
    noun: "template",
    hiddenWhenInactive:
      "hides it from the create wizard but keeps it for reference, and never changes an event created from it",
    checkUsage: templateUsageAction,
    remove: deleteTemplateAction,
    deactivate: (id) => setTemplateActiveAction(id, false),
    onDone: () => router.refresh(),
  });

  const visibleTemplates = templates.filter((t) => showInactive || t.active);
  const inactiveCount = templates.length - templates.filter((t) => t.active).length;

  const roleTypeName = (id: number) => roleTypes.find((rt) => rt.id === id)?.name ?? `Role #${id}`;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    const result = await createTemplateAction(addInput);
    setAdding(false);
    if (!result.ok) {
      setAddError(result.error);
      return;
    }
    setAddInput(EMPTY_TEMPLATE);
    setShowAdd(false);
    router.refresh();
  };

  const startEdit = (template: EventTemplateWithRoles) => {
    setEditingId(template.id);
    setEditInput(toInput(template));
    setEditError(null);
  };

  const saveEdit = async (id: number) => {
    setBusyId(id);
    setEditError(null);
    const result = await updateTemplateAction(id, editInput);
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
    await setTemplateActiveAction(id, active);
    setBusyId(null);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!showAdd && (
            <Button type="button" onClick={() => setShowAdd(true)} className="w-fit">
              New template
            </Button>
          )}
          {showAdd && (
            <form onSubmit={handleAdd} className="flex flex-col gap-4 rounded-md border p-3">
              <TemplateFormFields
                value={addInput}
                onChange={setAddInput}
                roleTypes={roleTypes}
                eventTypes={eventTypes}
                venues={venues}
                idPrefix="add_template"
              />
              {addError && <p className="text-sm text-red-500">{addError}</p>}
              <div className="flex gap-2">
                <Button type="submit" disabled={adding}>
                  {adding ? "Creating..." : "Create template"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowAdd(false);
                    setAddInput(EMPTY_TEMPLATE);
                    setAddError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}

          <ShowInactiveToggle
            id="templates_show_inactive"
            count={inactiveCount}
            checked={showInactive}
            onChange={setShowInactive}
          />

          {visibleTemplates.map((template) => (
            <div key={template.id} className="rounded-md border p-3">
              {editingId === template.id ? (
                <div className="flex flex-col gap-4">
                  <TemplateFormFields
                    value={editInput}
                    onChange={setEditInput}
                    roleTypes={roleTypes}
                    eventTypes={eventTypes}
                    venues={venues}
                    idPrefix={`edit_template_${template.id}`}
                  />
                  {editError && <p className="text-sm text-red-500">{editError}</p>}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      disabled={busyId === template.id}
                      onClick={() => saveEdit(template.id)}
                    >
                      Save
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{template.name}</span>
                      {!template.active && <Badge variant="secondary">Inactive</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {template.event_type} · {template.chapter ?? "All chapters"}
                    </p>
                    {(template.default_title || template.default_venue_name) && (
                      <p className="text-sm text-muted-foreground">
                        {[
                          template.default_title && `Title: ${template.default_title}`,
                          template.default_venue_name && `Venue: ${template.default_venue_name}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      Capacity: {template.default_capacity ?? "Unlimited"} · Sections:{" "}
                      {sectionsLabel(template.default_registration_sections)}
                    </p>
                    {template.roles.length > 0 && (
                      <p className="text-sm text-muted-foreground">
                        Roles:{" "}
                        {template.roles
                          .map((r) => `${r.title || roleTypeName(r.role_type_id)} (${r.number_needed})`)
                          .join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => startEdit(template)}>
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busyId === template.id}
                      onClick={() => toggleActive(template.id, !template.active)}
                    >
                      {template.active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busyId === template.id || deleteFlow.isBusy(template.id)}
                      onClick={() => deleteFlow.begin(template)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              )}
              {deleteFlow.panelFor(template.id)}
            </div>
          ))}

          {templates.length === 0 && !showAdd && (
            <p className="text-sm text-muted-foreground">No templates yet.</p>
          )}
          {templates.length > 0 && visibleTemplates.length === 0 && (
            <p className="text-sm text-muted-foreground">All templates are inactive.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
