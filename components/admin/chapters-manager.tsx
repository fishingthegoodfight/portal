"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";

import {
  createChapterAction,
  createRegionAction,
  renameRegionAction,
  reorderChaptersAction,
  reorderRegionsAction,
  setChapterActiveAction,
  setRegionActiveAction,
  updateChapterAction,
  type ChapterInput,
} from "@/lib/actions/chapters";
import type { Chapter, Region } from "@/lib/chapters";
import { CHAPTER_TIMEZONES, chapterTimezoneLabel } from "@/lib/chapter-timezones";
import { US_STATES } from "@/lib/us-states";
import { ShowInactiveToggle } from "@/components/admin/setup-list-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/** Up/down buttons that swap a row with its visible neighbour. */
function MoveButtons({
  first,
  last,
  disabled,
  onMove,
}: {
  first: boolean;
  last: boolean;
  disabled: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <div className="flex gap-1">
      <Button type="button" variant="ghost" size="sm" disabled={first || disabled} onClick={() => onMove(-1)} aria-label="Move up">
        <ChevronUp className="size-4" />
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={last || disabled} onClick={() => onMove(1)} aria-label="Move down">
        <ChevronDown className="size-4" />
      </Button>
    </div>
  );
}

/** Swaps two visible neighbours within the full ordered list — hidden
 * (inactive) rows keep their place in the saved order. */
function swapped<T>(all: T[], visible: T[], index: number, direction: -1 | 1): T[] | null {
  const target = index + direction;
  if (target < 0 || target >= visible.length) return null;
  const from = all.indexOf(visible[index]);
  const to = all.indexOf(visible[target]);
  const next = [...all];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function ChaptersManager({ regions, chapters }: { regions: Region[]; chapters: Chapter[] }) {
  const sortedRegions = [...regions].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  return (
    <div className="flex flex-col gap-6">
      <RegionsCard regions={sortedRegions} chapters={chapters} />
      <ChaptersCard regions={sortedRegions} chapters={chapters} />
    </div>
  );
}

// ---- Regions -------------------------------------------------------------------

function RegionsCard({ regions, chapters }: { regions: Region[]; chapters: Chapter[] }) {
  const router = useRouter();
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const visible = regions.filter((r) => showInactive || r.active);
  const inactiveCount = regions.filter((r) => !r.active).length;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    const result = await createRegionAction(addName);
    setAdding(false);
    if (!result.ok) {
      setAddError(result.error);
      return;
    }
    setAddName("");
    router.refresh();
  };

  const saveName = async (id: number) => {
    setBusyId(id);
    setEditError(null);
    const result = await renameRegionAction(id, editName);
    setBusyId(null);
    if (!result.ok) {
      setEditError(result.error);
      return;
    }
    setEditingId(null);
    router.refresh();
  };

  const toggleActive = async (region: Region) => {
    setBusyId(region.id);
    await setRegionActiveAction(region.id, !region.active);
    setBusyId(null);
    router.refresh();
  };

  const move = async (index: number, direction: -1 | 1) => {
    const next = swapped(regions, visible, index, direction);
    if (!next) return;
    setBusyId(visible[index].id);
    await reorderRegionsAction(next.map((r) => r.id));
    setBusyId(null);
    router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Regions</CardTitle>
        <CardDescription>
          Groups of chapters, for internal grouping and the volunteer opportunities email.
          Participants still filter events by chapter, never by region. Deactivating a region
          only stops new chapters being put in it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="grid flex-1 gap-2">
            <Label htmlFor="add_region_name">New region</Label>
            <Input
              id="add_region_name"
              required
              placeholder="e.g. Texas"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={adding}>
            {adding ? "Adding..." : "Add region"}
          </Button>
        </form>
        {addError && <p className="text-sm text-red-500">{addError}</p>}

        <ShowInactiveToggle
          id="regions_show_inactive"
          count={inactiveCount}
          checked={showInactive}
          onChange={setShowInactive}
        />
        {visible.length === 0 && <p className="text-sm text-muted-foreground">No regions yet.</p>}
        {visible.map((region, i) => {
          const count = chapters.filter((c) => c.region_id === region.id).length;
          return (
            <div key={region.id} className="rounded-md border p-3">
              {editingId === region.id ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`region_${region.id}_name`}>Name</Label>
                  <Input
                    id={`region_${region.id}_name`}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                  {editError && <p className="text-sm text-red-500">{editError}</p>}
                  <div className="flex gap-2">
                    <Button type="button" size="sm" disabled={busyId === region.id} onClick={() => saveName(region.id)}>
                      Save
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{region.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {count} {count === 1 ? "chapter" : "chapters"}
                    </span>
                    {!region.active && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <MoveButtons
                      first={i === 0}
                      last={i === visible.length - 1}
                      disabled={busyId === region.id}
                      onMove={(d) => move(i, d)}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingId(region.id);
                        setEditName(region.name);
                        setEditError(null);
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busyId === region.id}
                      onClick={() => toggleActive(region)}
                    >
                      {region.active ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ---- Chapters ------------------------------------------------------------------

function emptyChapterInput(regions: Region[]): ChapterInput {
  return {
    name: "",
    displayName: "",
    regionId: regions.find((r) => r.active)?.id ?? 0,
    state: "",
    timezone: "",
  };
}

function toInput(chapter: Chapter): ChapterInput {
  return {
    name: chapter.name,
    displayName: chapter.display_name ?? "",
    regionId: chapter.region_id,
    state: chapter.state,
    timezone: chapter.timezone,
  };
}

function ChapterFields({
  value,
  onChange,
  regions,
  idPrefix,
}: {
  value: ChapterInput;
  onChange: (next: ChapterInput) => void;
  regions: Region[];
  idPrefix: string;
}) {
  const set = <K extends keyof ChapterInput>(key: K, v: ChapterInput[K]) => onChange({ ...value, [key]: v });
  // Active regions, plus the chapter's own if it's since been deactivated.
  const regionOptions = regions.filter((r) => r.active || r.id === value.regionId);
  const zoneOptions = CHAPTER_TIMEZONES.some((tz) => tz.value === value.timezone) || !value.timezone
    ? CHAPTER_TIMEZONES
    : [...CHAPTER_TIMEZONES, { value: value.timezone, label: value.timezone }];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}_name`}>Name</Label>
          <Input
            id={`${idPrefix}_name`}
            required
            placeholder="e.g. Boulder"
            value={value.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}_display_name`}>
            Longer name <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id={`${idPrefix}_display_name`}
            placeholder="e.g. Colorado Springs for CO Springs"
            value={value.displayName}
            onChange={(e) => set("displayName", e.target.value)}
          />
        </div>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">
        The longer name, if any, is what the events filter and the volunteer application show.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}_region`}>Region</Label>
          <Select
            id={`${idPrefix}_region`}
            required
            value={value.regionId ? String(value.regionId) : ""}
            onChange={(e) => set("regionId", Number(e.target.value))}
          >
            <option value="">Choose a region</option>
            {regionOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}_state`}>State</Label>
          <Select id={`${idPrefix}_state`} required value={value.state} onChange={(e) => set("state", e.target.value)}>
            <option value="">State</option>
            {US_STATES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}_timezone`}>Time zone</Label>
          <Select
            id={`${idPrefix}_timezone`}
            required
            value={value.timezone}
            onChange={(e) => set("timezone", e.target.value)}
          >
            <option value="">Time zone</option>
            {zoneOptions.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">
        The state decides which waiver its events use, and the time zone is the default for new
        events. Changing either never changes an event that already exists.
      </p>
    </div>
  );
}

function ChaptersCard({ regions, chapters }: { regions: Region[]; chapters: Chapter[] }) {
  const router = useRouter();
  const [addInput, setAddInput] = useState<ChapterInput>(() => emptyChapterInput(regions));
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editInput, setEditInput] = useState<ChapterInput>(() => emptyChapterInput(regions));
  const [editError, setEditError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const inactiveCount = chapters.filter((c) => !c.active).length;
  const byRegion = regions
    .map((region) => ({
      region,
      all: chapters
        .filter((c) => c.region_id === region.id)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.all.length > 0);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    const result = await createChapterAction(addInput);
    setAdding(false);
    if (!result.ok) {
      setAddError(result.error);
      return;
    }
    setAddInput(emptyChapterInput(regions));
    router.refresh();
  };

  const save = async (chapter: Chapter) => {
    setBusyId(chapter.id);
    setEditError(null);
    const result = await updateChapterAction(chapter.id, editInput);
    setBusyId(null);
    if (!result.ok) {
      setEditError(result.error);
      return;
    }
    setEditingId(null);
    router.refresh();
  };

  const toggleActive = async (chapter: Chapter) => {
    setBusyId(chapter.id);
    await setChapterActiveAction(chapter.id, !chapter.active);
    setBusyId(null);
    router.refresh();
  };

  const move = async (all: Chapter[], visible: Chapter[], index: number, direction: -1 | 1) => {
    const next = swapped(all, visible, index, direction);
    if (!next) return;
    setBusyId(visible[index].id);
    await reorderChaptersAction(next.map((c) => c.id));
    setBusyId(null);
    router.refresh();
  };

  const renaming = editingId != null && chapters.find((c) => c.id === editingId)?.name !== editInput.name.trim();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chapters</CardTitle>
        <CardDescription>
          Every chapter picker, the events filter and the volunteer application use this list,
          in this order (by region, then chapter). Deactivating a chapter hides it from all of
          them; its events and people keep it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={add} className="flex flex-col gap-3 rounded-md border p-3">
          <span className="text-sm font-medium">Add a chapter</span>
          <ChapterFields value={addInput} onChange={setAddInput} regions={regions} idPrefix="add_chapter" />
          <p className="text-xs text-muted-foreground">
            A chapter in a new state needs that state&apos;s participant waiver published (Waivers)
            before its events can take registrations, and a volunteer waiver before volunteers
            there can register.
          </p>
          {addError && <p className="text-sm text-red-500">{addError}</p>}
          <div>
            <Button type="submit" disabled={adding}>
              {adding ? "Adding..." : "Add chapter"}
            </Button>
          </div>
        </form>

        <ShowInactiveToggle
          id="chapters_show_inactive"
          count={inactiveCount}
          checked={showInactive}
          onChange={setShowInactive}
        />
        {byRegion.map(({ region, all }) => {
          const visible = all.filter((c) => showInactive || c.active);
          if (visible.length === 0) return null;
          return (
            <div key={region.id} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted-foreground">{region.name}</h3>
              {visible.map((chapter, i) => (
                <div key={chapter.id} className="rounded-md border p-3">
                  {editingId === chapter.id ? (
                    <div className="flex flex-col gap-3">
                      <ChapterFields
                        value={editInput}
                        onChange={setEditInput}
                        regions={regions}
                        idPrefix={`edit_chapter_${chapter.id}`}
                      />
                      {renaming && (
                        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm text-amber-700 dark:text-amber-400">
                          Renaming changes it everywhere: every event, profile, chapter lead, template,
                          venue and application that has &ldquo;{chapter.name}&rdquo; gets the new name.
                          Links to the events filter for the old name stop selecting it.
                        </p>
                      )}
                      {editError && <p className="text-sm text-red-500">{editError}</p>}
                      <div className="flex gap-2">
                        <Button type="button" size="sm" disabled={busyId === chapter.id} onClick={() => save(chapter)}>
                          {busyId === chapter.id ? "Saving..." : "Save"}
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
                          <span className="font-medium">
                            {chapter.name}, {chapter.state}
                          </span>
                          {!chapter.active && <Badge variant="secondary">Inactive</Badge>}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {[chapter.display_name && `Shown as “${chapter.display_name}”`, chapterTimezoneLabel(chapter.timezone)]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <MoveButtons
                          first={i === 0}
                          last={i === visible.length - 1}
                          disabled={busyId === chapter.id}
                          onMove={(d) => move(all, visible, i, d)}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingId(chapter.id);
                            setEditInput(toInput(chapter));
                            setEditError(null);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyId === chapter.id}
                          onClick={() => toggleActive(chapter)}
                        >
                          {chapter.active ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
