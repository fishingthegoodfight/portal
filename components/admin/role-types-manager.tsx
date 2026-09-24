"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";

import {
  createRoleTypeAction,
  deleteRoleTypeAction,
  reorderRoleTypesAction,
  roleTypeUsageAction,
  setRoleTypeActiveAction,
  updateRoleTypeAction,
  type RoleTypeInput,
} from "@/lib/actions/volunteer-role-types";
import { ROLE_TYPE_GROUP_LABELS, roleTypeGroup, type VolunteerRoleType } from "@/lib/volunteers";
import { ShowInactiveToggle, useDeleteFlow } from "@/components/admin/setup-list-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const EMPTY_INPUT: RoleTypeInput = {
  name: "",
  description: "",
  forRetreats: false,
  forChapterEvents: false,
  requiresCert: false,
};

function toInput(role: VolunteerRoleType): RoleTypeInput {
  return {
    name: role.name,
    description: role.description ?? "",
    forRetreats: role.for_retreats,
    forChapterEvents: role.for_chapter_events,
    requiresCert: role.requires_cert,
  };
}

function RoleTypeFields({
  value,
  onChange,
  idPrefix,
}: {
  value: RoleTypeInput;
  onChange: (next: RoleTypeInput) => void;
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
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}_description`}>Description</Label>
        <Textarea
          id={`${idPrefix}_description`}
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
        />
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={value.forRetreats}
            onCheckedChange={(c) => onChange({ ...value, forRetreats: c === true })}
          />
          Retreats
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={value.forChapterEvents}
            onCheckedChange={(c) => onChange({ ...value, forChapterEvents: c === true })}
          />
          Chapter events
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={value.requiresCert}
            onCheckedChange={(c) => onChange({ ...value, requiresCert: c === true })}
          />
          Requires First Aid/CPR/AED
        </label>
      </div>
    </div>
  );
}

export function RoleTypesManager({ roleTypes }: { roleTypes: VolunteerRoleType[] }) {
  const router = useRouter();
  const [addInput, setAddInput] = useState<RoleTypeInput>(EMPTY_INPUT);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editInput, setEditInput] = useState<RoleTypeInput>(EMPTY_INPUT);
  const [editError, setEditError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const deleteFlow = useDeleteFlow({
    noun: "role type",
    hiddenWhenInactive:
      "hides it from new event builds and new approvals but keeps existing approvals and event roles intact",
    checkUsage: roleTypeUsageAction,
    remove: deleteRoleTypeAction,
    deactivate: (id) => setRoleTypeActiveAction(id, false),
    onDone: () => router.refresh(),
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    const result = await createRoleTypeAction(addInput);
    setAdding(false);
    if (!result.ok) {
      setAddError(result.error);
      return;
    }
    setAddInput(EMPTY_INPUT);
    router.refresh();
  };

  const startEdit = (role: VolunteerRoleType) => {
    setEditingId(role.id);
    setEditInput(toInput(role));
    setEditError(null);
  };

  const saveEdit = async (id: number) => {
    setBusyId(id);
    setEditError(null);
    const result = await updateRoleTypeAction(id, editInput);
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
    await setRoleTypeActiveAction(id, active);
    setBusyId(null);
    router.refresh();
  };

  /** Swaps two visible neighbours within their full group — inactive roles
   * hidden from view keep their place in the saved order. */
  const move = async (
    group: VolunteerRoleType[],
    visible: VolunteerRoleType[],
    index: number,
    direction: -1 | 1,
  ) => {
    const target = index + direction;
    if (target < 0 || target >= visible.length) return;
    const from = group.indexOf(visible[index]);
    const to = group.indexOf(visible[target]);
    const reordered = [...group];
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    setBusyId(visible[index].id);
    await reorderRoleTypesAction(reordered.map((r) => r.id));
    setBusyId(null);
    router.refresh();
  };

  const inactiveCount = roleTypes.filter((r) => !r.active).length;
  const groups: {
    key: "retreats" | "chapter_events" | "both";
    roles: VolunteerRoleType[];
    visible: VolunteerRoleType[];
  }[] = (["retreats", "chapter_events", "both"] as const).map((key) => {
    const roles = roleTypes
      .filter((r) => roleTypeGroup(r) === key)
      .sort((a, b) => a.sort_order - b.sort_order);
    return { key, roles, visible: roles.filter((r) => showInactive || r.active) };
  });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add role type</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-col gap-4">
            <RoleTypeFields value={addInput} onChange={setAddInput} idPrefix="add_role" />
            {addError && <p className="text-sm text-red-500">{addError}</p>}
            <div>
              <Button type="submit" disabled={adding}>
                {adding ? "Adding..." : "Add role type"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <ShowInactiveToggle
        id="role_types_show_inactive"
        count={inactiveCount}
        checked={showInactive}
        onChange={setShowInactive}
      />

      {groups.map(
        (group) =>
          group.visible.length > 0 && (
            <Card key={group.key}>
              <CardHeader>
                <CardTitle>{ROLE_TYPE_GROUP_LABELS[group.key]}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {group.visible.map((role, i) => (
                  <div key={role.id} className="rounded-md border p-3">
                    {editingId === role.id ? (
                      <div className="flex flex-col gap-3">
                        <RoleTypeFields value={editInput} onChange={setEditInput} idPrefix={`edit_${role.id}`} />
                        {editError && <p className="text-sm text-red-500">{editError}</p>}
                        <div className="flex gap-2">
                          <Button type="button" size="sm" disabled={busyId === role.id} onClick={() => saveEdit(role.id)}>
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
                            <span className="font-medium">{role.name}</span>
                            {role.requires_cert && <Badge variant="outline">Cert required</Badge>}
                            {!role.active && <Badge variant="secondary">Inactive</Badge>}
                          </div>
                          {role.description && (
                            <p className="text-sm text-muted-foreground">{role.description}</p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={i === 0 || busyId === role.id}
                              onClick={() => move(group.roles, group.visible, i, -1)}
                              aria-label="Move up"
                            >
                              <ChevronUp className="size-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={i === group.visible.length - 1 || busyId === role.id}
                              onClick={() => move(group.roles, group.visible, i, 1)}
                              aria-label="Move down"
                            >
                              <ChevronDown className="size-4" />
                            </Button>
                          </div>
                          <div className="flex gap-2">
                            <Button type="button" size="sm" variant="outline" onClick={() => startEdit(role)}>
                              Edit
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busyId === role.id}
                              onClick={() => toggleActive(role.id, !role.active)}
                            >
                              {role.active ? "Deactivate" : "Activate"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busyId === role.id || deleteFlow.isBusy(role.id)}
                              onClick={() => deleteFlow.begin(role)}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                    {deleteFlow.panelFor(role.id)}
                  </div>
                ))}
              </CardContent>
            </Card>
          ),
      )}
    </div>
  );
}
