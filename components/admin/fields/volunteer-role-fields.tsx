"use client";

import type { VolunteerRoleInput } from "@/lib/actions/admin-create-event";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type VolunteerRoleTypeOption = {
  id: number;
  name: string;
  /** Retreat roles (e.g. Fishing Instructor) are only offered at an event
   * that requires health history — see roleTypesForEvent. */
  for_retreats?: boolean;
  for_chapter_events?: boolean;
};

/** The role types an event's form offers: chapter-event roles always, and
 * retreat roles too when the event requires health history (retreats,
 * fish-a-longs — where instructor shifts and the practical check apply).
 * `keepIds` stay offered whatever they are, so saving never drops a type a
 * role already uses. */
export function roleTypesForEvent(
  roleTypes: VolunteerRoleTypeOption[],
  requiresHealthHistory: boolean,
  keepIds: Set<number> = new Set(),
): VolunteerRoleTypeOption[] {
  return roleTypes.filter(
    (rt) => rt.for_chapter_events || (requiresHealthHistory && rt.for_retreats) || keepIds.has(rt.id),
  );
}

/** One volunteer role's fields — shared by the create wizard's Volunteers
 * step and the edit form's Volunteer roles section. The caller renders the
 * surrounding card and its header (remove/cancel controls differ). */
export function VolunteerRoleFields({
  idPrefix,
  index,
  role,
  roleTypes,
  onChange,
  signedUp = 0,
}: {
  idPrefix: string;
  index: number;
  role: VolunteerRoleInput;
  roleTypes: VolunteerRoleTypeOption[];
  onChange: (field: keyof VolunteerRoleInput, value: string) => void;
  /** On an existing role, how many are already signed up — the lowest
   * "Number needed" allowed (the server enforces the same floor). */
  signedUp?: number;
}) {
  const id = (field: string) => `${idPrefix}_role_${index}_${field}`;

  return (
    <>
      {roleTypes.length > 0 && (
        <div className="grid gap-2">
          <Label htmlFor={id("role_type")}>Role type</Label>
          {/* "Custom / other" has no role type, so there's nothing to approve
            * a volunteer against — it's open to any approved volunteer (see
            * isRoleEligible in lib/volunteer-signups.ts). */}
          <Select
            id={id("role_type")}
            value={role.roleTypeId}
            onChange={(e) => {
              const roleTypeId = e.target.value;
              const matched = roleTypes.find((rt) => String(rt.id) === roleTypeId);
              onChange("roleTypeId", roleTypeId);
              if (matched && !role.title.trim()) onChange("title", matched.name);
            }}
          >
            <option value="">Custom / other (no role type)</option>
            {roleTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor={id("title")}>Title</Label>
        <Input
          id={id("title")}
          required
          value={role.title}
          onChange={(e) => onChange("title", e.target.value)}
        />
      </div>
      <RoleDescriptionField
        id={id("description")}
        value={role.description}
        onChange={(value) => onChange("description", value)}
      />
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor={id("shift_start")}>Shift start</Label>
          <Input
            id={id("shift_start")}
            type="time"
            required
            value={role.shiftStart}
            onChange={(e) => onChange("shiftStart", e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={id("shift_end")}>Shift end</Label>
          <Input
            id={id("shift_end")}
            type="time"
            required
            value={role.shiftEnd}
            onChange={(e) => onChange("shiftEnd", e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={id("bring")}>What to bring or wear</Label>
        <Input
          id={id("bring")}
          placeholder="Optional"
          value={role.whatToBring}
          onChange={(e) => onChange("whatToBring", e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={id("needed")}>Number needed</Label>
        <Input
          id={id("needed")}
          type="number"
          inputMode="numeric"
          min={Math.max(signedUp, 1)}
          required
          value={role.numberNeeded}
          onChange={(e) => onChange("numberNeeded", e.target.value)}
        />
        {signedUp > 0 && (
          <p className="text-xs text-muted-foreground">
            {signedUp} already signed up — can&apos;t go lower than that.
          </p>
        )}
      </div>
    </>
  );
}

/** A volunteer role's description — shared by the create wizard, the edit
 * form (via VolunteerRoleFields above), and the template editor's roles. */
export function RoleDescriptionField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Description</Label>
      <Textarea
        id={id}
        aria-describedby={`${id}_help`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}_help`} className="text-xs text-muted-foreground">
        What will this person actually do? Example: &ldquo;Set up tables and vises before doors
        open, then help newcomers get started.&rdquo;
      </p>
    </div>
  );
}

/** Per-role problems, same rules for create and edit (the server actions
 * re-check them). `label` names the role in each message. */
export function volunteerRoleErrors(
  role: VolunteerRoleInput,
  label: string,
  signedUp = 0,
  /** At an event that requires health history every role needs a role
   * type — a free-text role there would slip past the practical-check
   * block (volunteer_opportunities_role_type_guard enforces it too). */
  requireRoleType = false,
): string[] {
  const errors: string[] = [];
  if (!role.title.trim()) errors.push(`${label}: title is required`);
  if (requireRoleType && !role.roleTypeId) {
    errors.push(`${label}: choose a role type — every volunteer role at an event that requires health history needs one`);
  }
  const needed = Number(role.numberNeeded.trim());
  if (!role.numberNeeded.trim() || !Number.isInteger(needed) || needed < 1) {
    errors.push(`${label}: number needed must be at least 1`);
  } else if (needed < signedUp) {
    errors.push(`${label}: ${signedUp} already signed up, so number needed can't be lower than that`);
  }
  if (!role.shiftStart || !role.shiftEnd) {
    errors.push(`${label}: shift start and end are required`);
  } else if (role.shiftEnd <= role.shiftStart) {
    errors.push(`${label}: shift end must be after shift start`);
  }
  return errors;
}
