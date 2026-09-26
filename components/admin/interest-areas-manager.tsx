"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  createInterestAreaAction,
  setInterestAreaActiveAction,
  updateInterestAreaAction,
  type InterestAreaInput,
} from "@/lib/actions/interest-areas";
import { INTEREST_AREA_KINDS, type InterestArea, type InterestAreaKind } from "@/lib/volunteer-applications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

function Fields({
  value,
  onChange,
  idPrefix,
}: {
  value: InterestAreaInput;
  onChange: (next: InterestAreaInput) => void;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[9rem_1fr_1fr_5rem]">
      <div className="grid gap-1">
        <Label htmlFor={`${idPrefix}_kind`} className="text-xs">List</Label>
        <Select
          id={`${idPrefix}_kind`}
          value={value.kind}
          onChange={(e) => onChange({ ...value, kind: e.target.value as InterestAreaKind })}
        >
          {INTEREST_AREA_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${idPrefix}_label`} className="text-xs">Wording</Label>
        <Input id={`${idPrefix}_label`} value={value.label} onChange={(e) => onChange({ ...value, label: e.target.value })} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${idPrefix}_desc`} className="text-xs">Examples (optional)</Label>
        <Input
          id={`${idPrefix}_desc`}
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          placeholder="e.g. Instagram, newsletter"
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${idPrefix}_order`} className="text-xs">Order</Label>
        <Input
          id={`${idPrefix}_order`}
          type="number"
          value={String(value.sortOrder)}
          onChange={(e) => onChange({ ...value, sortOrder: Number(e.target.value) })}
        />
      </div>
    </div>
  );
}

/** Setup → Interest areas, in the application's two lists. Rewording or
 * reordering here changes the application form only — role types are
 * untouched. */
export function InterestAreasManager({ areas }: { areas: InterestArea[] }) {
  const router = useRouter();
  const nextOrder = (areas.reduce((m, a) => Math.max(m, a.sort_order), 0) || 0) + 10;
  const [adding, setAdding] = useState<InterestAreaInput>({ kind: "skill", label: "", description: "", sortOrder: nextOrder });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editing, setEditing] = useState<InterestAreaInput>({ kind: "skill", label: "", description: "", sortOrder: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong");
      return;
    }
    after?.();
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      {INTEREST_AREA_KINDS.map((kind) => (
        <Card key={kind.value}>
          <CardHeader>
            <CardTitle>{kind.label}</CardTitle>
            <p className="text-sm text-muted-foreground">On the application: &ldquo;{kind.question}&rdquo;</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {areas.filter((area) => area.kind === kind.value).map((area) =>
              editingId === area.id ? (
                <div key={area.id} className="flex flex-col gap-2 rounded-md border p-3">
                  <Fields value={editing} onChange={setEditing} idPrefix={`area_${area.id}`} />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => run(() => updateInterestAreaAction(area.id, editing), () => setEditingId(null))}
                    >
                      Save
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div key={area.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-2 font-medium">
                      {area.label}
                      {!area.active && <Badge variant="secondary">Off</Badge>}
                    </span>
                    {area.description && <span className="text-sm text-muted-foreground">{area.description}</span>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setEditing({ kind: area.kind, label: area.label, description: area.description ?? "", sortOrder: area.sort_order });
                        setEditingId(area.id);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => run(() => setInterestAreaActiveAction(area.id, !area.active))}
                    >
                      {area.active ? "Turn off" : "Turn on"}
                    </Button>
                  </div>
                </div>
              ),
            )}
            {kind.value === "skill" && (
              <p className="text-xs text-muted-foreground">
                The form always adds an &ldquo;Other&rdquo; box with a description here, as the registration form does.
              </p>
            )}
          </CardContent>
        </Card>
      ))}
      {error && <p className="text-sm text-red-500">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Add one</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Fields value={adding} onChange={setAdding} idPrefix="area_new" />
          <div>
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                run(
                  () => createInterestAreaAction(adding),
                  () => setAdding({ kind: adding.kind, label: "", description: "", sortOrder: nextOrder + 10 }),
                )
              }
            >
              Add interest area
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
